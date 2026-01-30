"""
测试脚本：检查3dm文件中的UserText
"""
import sys
from pathlib import Path
import rhino3dm


def _iter_user_strings(source):
    if source is None or not hasattr(source, "GetUserStrings"):
        return []
    try:
        entries = source.GetUserStrings()
    except Exception:
        return []

    if isinstance(entries, dict):
        return list(entries.items())

    if isinstance(entries, (list, tuple)):
        pairs = []
        for entry in entries:
            if isinstance(entry, (list, tuple)) and len(entry) == 2:
                pairs.append((entry[0], entry[1]))
                continue
            key = getattr(entry, "Key", None)
            value = getattr(entry, "Value", None)
            if key is not None:
                pairs.append((key, value))
        return pairs

    return []

def test_usertext(model_path: str):
    """测试读取3dm文件中的UserText"""

    print(f"正在读取模型: {model_path}")
    file3dm = rhino3dm.File3dm.Read(model_path)

    if file3dm is None:
        print("错误: 无法读取3dm文件")
        return

    print(f"成功读取模型，共有 {len(file3dm.Objects)} 个对象")
    print(f"图层数量: {len(file3dm.Layers)}")
    print()

    # 列出所有图层
    print("=== 图层列表 ===")
    for i, layer in enumerate(file3dm.Layers):
        layer_name = getattr(layer, "Name", None) or getattr(layer, "name", None) or f"Layer {i}"
        if callable(layer_name):
            try:
                layer_name = layer_name()
            except:
                pass
        print(f"  图层 {i}: {layer_name}")
    print()

    # 检查每个对象
    print("=== 对象信息 ===")
    for idx, obj in enumerate(file3dm.Objects):
        geometry = obj.Geometry
        if geometry is None:
            continue

        # 获取图层信息
        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None

        # 获取几何体类型
        geom_type = type(geometry).__name__

        print(f"\n对象 {idx}:")
        print(f"  图层索引: {layer_index}")
        print(f"  几何类型: {geom_type}")

        # 尝试读取UserText
        if attributes:
            print(f"  Attributes类型: {type(attributes)}")
            print(f"  Attributes可用方法: {[m for m in dir(attributes) if not m.startswith('_')][:10]}")

            if hasattr(attributes, "UserStringCount"):
                print(f"  UserStringCount: {attributes.UserStringCount}")

            entries = _iter_user_strings(attributes)
            if entries:
                print(f"  UserText键数量: {len(entries)}")
                for key, value in entries:
                    print(f"    {key} = {value}")
            else:
                print("  没有UserStrings")
        else:
            print(f"  没有Attributes")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python test_usertext.py <3dm文件路径>")
        print("示例: python test_usertext.py data/uploads/model.3dm")
        sys.exit(1)

    model_path = sys.argv[1]
    if not Path(model_path).exists():
        print(f"错误: 文件不存在: {model_path}")
        sys.exit(1)

    test_usertext(model_path)
