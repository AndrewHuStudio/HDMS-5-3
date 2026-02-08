from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple, List, Dict

import rhino3dm


def _normalize_layer_name(name: str) -> str:
    return name.strip().lower()


def _layer_leaf_name(name: str) -> str | None:
    if "::" not in name:
        return None
    parts = [part.strip() for part in name.split("::") if part.strip()]
    if not parts:
        return None
    return parts[-1]


def _expand_layer_name(name: str) -> set[str]:
    normalized = _normalize_layer_name(name)
    if not normalized:
        return set()
    expanded = {normalized}
    leaf = _layer_leaf_name(name)
    if leaf:
        expanded.add(_normalize_layer_name(leaf))
    return expanded


def _normalize_layers(layer_names: Iterable[str]) -> set[str]:
    normalized: set[str] = set()
    for name in layer_names:
        if not name or not name.strip():
            continue
        normalized.update(_expand_layer_name(name))
    return normalized


def _layer_index(layer: rhino3dm.Layer, fallback: int) -> int:
    index = getattr(layer, "Index", None)
    if isinstance(index, int):
        return index
    index = getattr(layer, "index", None)
    if isinstance(index, int):
        return index
    return fallback


def _layer_name_candidates(layer: rhino3dm.Layer) -> tuple[set[str], str]:
    names: List[str] = []
    for attr in ("FullPath", "fullPath", "Name", "name"):
        value = getattr(layer, attr, None)
        if callable(value):
            try:
                value = value()
            except TypeError:
                value = None
        if isinstance(value, str) and value.strip():
            names.append(value)
    normalized: set[str] = set()
    for name in names:
        normalized.update(_expand_layer_name(name))
    display_name = names[0] if names else ""
    return normalized, display_name


def _layer_id(layer: rhino3dm.Layer) -> str | None:
    for attr in ("Id", "id"):
        value = getattr(layer, attr, None)
        if callable(value):
            try:
                value = value()
            except TypeError:
                value = None
        if value:
            return str(value)
    return None


def _layer_parent_id(layer: rhino3dm.Layer) -> str | None:
    for attr in ("ParentLayerId", "parentLayerId", "ParentId", "parentId"):
        value = getattr(layer, attr, None)
        if callable(value):
            try:
                value = value()
            except TypeError:
                value = None
        if value:
            return str(value)
    return None


def _layer_full_path(layer: rhino3dm.Layer) -> str | None:
    for attr in ("FullPath", "fullPath"):
        value = getattr(layer, attr, None)
        if callable(value):
            try:
                value = value()
            except TypeError:
                value = None
        if isinstance(value, str) and value.strip():
            return value
    return None


def _layer_visible(layer: rhino3dm.Layer) -> bool | None:
    for attr in ("IsVisible", "isVisible", "Visible", "visible"):
        value = getattr(layer, attr, None)
        if callable(value):
            try:
                value = value()
            except TypeError:
                value = None
        if isinstance(value, bool):
            return value
    return None


def _mesh_to_brep(mesh: rhino3dm.Mesh) -> rhino3dm.Brep | None:
    for trimmed in (True, False):
        try:
            brep = rhino3dm.Brep.CreateFromMesh(mesh, trimmed)
        except TypeError:
            brep = None
        if brep is not None:
            return brep
    return None


def _extrusion_to_brep(extrusion: rhino3dm.Extrusion) -> rhino3dm.Brep | None:
    for split_kinky_faces in (True, False):
        try:
            brep = extrusion.ToBrep(split_kinky_faces)
        except TypeError:
            brep = None
        if brep is not None:
            return brep
    return None


def load_breps_from_layers(
    model_path: Path, layer_names: Iterable[str]
) -> Tuple[List[rhino3dm.CommonObject], List[str]]:
    model = rhino3dm.File3dm.Read(str(model_path))
    if model is None:
        raise ValueError(f"Failed to read model: {model_path}")

    target_layers = _normalize_layers(layer_names)
    if not target_layers:
        raise ValueError("Layer list is empty")

    layer_by_index: dict[int, tuple[set[str], str]] = {}
    for i, layer in enumerate(model.Layers):
        layer_index = _layer_index(layer, i)
        candidates, display_name = _layer_name_candidates(layer)
        if not candidates:
            continue
        layer_by_index[layer_index] = (candidates, display_name)

    breps: List[rhino3dm.CommonObject] = []
    warnings: List[str] = []

    for obj in model.Objects:
        geom = obj.Geometry
        if geom is None:
            continue
        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None
        layer_entry = layer_by_index.get(layer_index)
        if not layer_entry:
            continue

        layer_names, layer_display_name = layer_entry
        if not (layer_names & target_layers):
            continue

        layer_name = layer_display_name or f"Layer {layer_index}"

        if isinstance(geom, rhino3dm.Brep):
            breps.append(geom)
            continue

        if isinstance(geom, rhino3dm.Curve):
            breps.append(geom)
            continue

        if isinstance(geom, rhino3dm.Extrusion):
            brep = _extrusion_to_brep(geom)
            if brep is not None:
                breps.append(brep)
                continue
            breps.append(geom)
            warnings.append(
                f"Extrusion used directly for layer '{layer_name}'; brep conversion failed"
            )
            continue

        if isinstance(geom, rhino3dm.Mesh):
            brep = _mesh_to_brep(geom)
            if brep is not None:
                breps.append(brep)
                continue
            breps.append(geom)
            warnings.append(
                f"Mesh used directly for layer '{layer_name}'; brep conversion failed"
            )
            continue

        # 支持Surface类型（单个曲面，如地面、水面等）
        if isinstance(geom, rhino3dm.Surface):
            breps.append(geom)
            continue

        # 支持Point类型
        if isinstance(geom, rhino3dm.Point):
            breps.append(geom)
            continue

        # 支持PointCloud类型
        if isinstance(geom, rhino3dm.PointCloud):
            breps.append(geom)
            continue

        # 支持TextDot类型（文本标注）
        if isinstance(geom, rhino3dm.TextDot):
            breps.append(geom)
            continue

        warnings.append(
            f"Skipped unsupported geometry type on layer '{layer_name}': {geom.ObjectType}"
        )

    if not breps:
        warnings.append("No geometries found for selected layers")

    return breps, warnings


def extract_layer_info(model_path: Path) -> Tuple[List[Dict[str, object]], List[str]]:
    model = rhino3dm.File3dm.Read(str(model_path))
    if model is None:
        raise ValueError(f"Failed to read model: {model_path}")

    object_counts: Dict[int, int] = {}
    for obj in model.Objects:
        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None
        if isinstance(layer_index, int):
            object_counts[layer_index] = object_counts.get(layer_index, 0) + 1

    layers: List[Dict[str, object]] = []
    id_to_index: Dict[str, int] = {}

    for i, layer in enumerate(model.Layers):
        layer_index = _layer_index(layer, i)
        layer_id = _layer_id(layer)
        if layer_id:
            id_to_index[layer_id] = layer_index

        _, display_name = _layer_name_candidates(layer)
        full_path = _layer_full_path(layer)
        name = full_path or display_name or f"Layer {layer_index}"
        visible = _layer_visible(layer)
        parent_id = _layer_parent_id(layer)

        layers.append(
            {
                "index": layer_index,
                "id": layer_id,
                "name": name,
                "full_path": full_path,
                "parent_id": parent_id,
                "parent_index": None,
                "visible": True if visible is None else visible,
                "object_count": object_counts.get(layer_index, 0),
            }
        )

    for layer in layers:
        parent_id = layer.get("parent_id")
        if isinstance(parent_id, str):
            layer["parent_index"] = id_to_index.get(parent_id)

    warnings: List[str] = []
    if not layers:
        warnings.append("No layers found in model")

    return layers, warnings
