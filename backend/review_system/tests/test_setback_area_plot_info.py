import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REVIEW_ROOT = Path(__file__).resolve().parents[1]
if str(REVIEW_ROOT) not in sys.path:
    sys.path.insert(0, str(REVIEW_ROOT))

from services.green_setback_check import check_green_setback_violation
from services.plaza_setback_check import check_plaza_setback_violation


def _point(x: float, y: float, z: float = 0.0) -> SimpleNamespace:
    return SimpleNamespace(X=x, Y=y, Z=z)


def _bbox(min_x: float, min_y: float, min_z: float, max_x: float, max_y: float, max_z: float) -> SimpleNamespace:
    return SimpleNamespace(
        Min=_point(min_x, min_y, min_z),
        Max=_point(max_x, max_y, max_z),
        Center=_point((min_x + max_x) / 2.0, (min_y + max_y) / 2.0, (min_z + max_z) / 2.0),
    )


class SetbackAreaPlotInfoTests(unittest.TestCase):
    def test_green_setback_area_results_and_shapes_include_plot_name(self) -> None:
        building_bbox = _bbox(20, 20, 0, 21, 21, 10)
        plot_bbox = _bbox(0, 0, 0, 100, 100, 0)

        def load_objects(_: object, layer: str):
            if layer == "场地_绿地退线":
                return [(SimpleNamespace(Attributes=None), "green-geometry")]
            if layer == "模型_建筑体块":
                return [(SimpleNamespace(Attributes=None), "building-geometry")]
            if layer == "场景_地块":
                return [(SimpleNamespace(Attributes=None), "plot-geometry")]
            return []

        def polygon_points(geometry: object):
            if geometry == "green-geometry":
                return [_point(0, 0, 0), _point(10, 0, 0), _point(0, 10, 0)]
            return []

        def bounding_box(geometry: object):
            if geometry == "plot-geometry":
                return plot_bbox
            if geometry == "building-geometry":
                return building_bbox
            return None

        with patch("services.green_setback_check.rhino3dm.File3dm.Read", return_value=object()), patch(
            "services.green_setback_check._candidate_plot_layers", return_value=["场景_地块"]
        ), patch("services.green_setback_check._load_objects_from_layer", side_effect=load_objects), patch(
            "services.green_setback_check._polygon_points_from_geometry", side_effect=polygon_points
        ), patch("services.green_setback_check._get_bounding_box", side_effect=bounding_box), patch(
            "services.green_setback_check._points_to_2d", side_effect=lambda points: [(p.X, p.Y) for p in points]
        ), patch(
            "services.green_setback_check._group_green_areas",
            return_value=[
                {
                    "outer": {
                        "name": "绿地1",
                        "min_z": 0.0,
                        "points2d": [(0.0, 0.0), (10.0, 0.0), (0.0, 10.0)],
                        "centroid": (3.0, 3.0),
                        "area": 50.0,
                    },
                    "holes": [],
                }
            ],
        ), patch("services.green_setback_check._polygons_intersect", return_value=False), patch(
            "services.green_setback_check._match_plot_name_by_point", return_value="测试地块A"
        ):
            result = check_green_setback_violation(model_path=Path("dummy.3dm"))

        self.assertEqual(result["area_results"][0]["plot_name"], "测试地块A")
        self.assertEqual(result["green_areas"][0]["plot_name"], "测试地块A")

    def test_plaza_setback_area_results_and_shapes_include_plot_name(self) -> None:
        building_bbox = _bbox(20, 20, 0, 21, 21, 10)
        plot_bbox = _bbox(0, 0, 0, 100, 100, 0)

        def load_objects(_: object, layer: str):
            if layer == "场地_广场退线":
                return [(SimpleNamespace(Attributes=None), "plaza-geometry")]
            if layer == "模型_建筑体块":
                return [(SimpleNamespace(Attributes=None), "building-geometry")]
            if layer == "场景_地块":
                return [(SimpleNamespace(Attributes=None), "plot-geometry")]
            return []

        def polygon_points(geometry: object):
            if geometry == "plaza-geometry":
                return [_point(0, 0, 0), _point(10, 0, 0), _point(0, 10, 0)]
            return []

        def bounding_box(geometry: object):
            if geometry == "plot-geometry":
                return plot_bbox
            if geometry == "building-geometry":
                return building_bbox
            return None

        with patch("services.plaza_setback_check.rhino3dm.File3dm.Read", return_value=object()), patch(
            "services.plaza_setback_check._candidate_plot_layers", return_value=["场景_地块"]
        ), patch("services.plaza_setback_check._load_objects_from_layer", side_effect=load_objects), patch(
            "services.plaza_setback_check._polygon_points_from_geometry", side_effect=polygon_points
        ), patch("services.plaza_setback_check._get_bounding_box", side_effect=bounding_box), patch(
            "services.plaza_setback_check._points_to_2d", side_effect=lambda points: [(p.X, p.Y) for p in points]
        ), patch(
            "services.plaza_setback_check._group_plaza_areas",
            return_value=[
                {
                    "outer": {
                        "name": "广场1",
                        "min_z": 0.0,
                        "points2d": [(0.0, 0.0), (10.0, 0.0), (0.0, 10.0)],
                        "centroid": (3.0, 3.0),
                        "area": 50.0,
                    },
                    "holes": [],
                }
            ],
        ), patch("services.plaza_setback_check._polygons_intersect", return_value=False), patch(
            "services.plaza_setback_check._match_plot_name_by_point", return_value="测试地块B"
        ):
            result = check_plaza_setback_violation(model_path=Path("dummy.3dm"))

        self.assertEqual(result["area_results"][0]["plot_name"], "测试地块B")
        self.assertEqual(result["plaza_areas"][0]["plot_name"], "测试地块B")


if __name__ == "__main__":
    unittest.main()
