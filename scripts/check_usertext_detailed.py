"""
测试脚本：详细检查UserText的位置
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

def check_usertext_detailed(model_path: str):
    """详细检查UserText设置位置"""

    print(f"正在读取模型: {model_path}\n")
    file3dm = rhino3dm.File3dm.Read(model_path)

    if file3dm is None:
        print("错误: 无法读取3dm文件")
        return

    print(f"成功读取模型")
    print(f"对象数量: {len(file3dm.Objects)}")
    print(f"图层数量: {len(file3dm.Layers)}\n")

    # 检查图层的UserText
    print("=== 检查图层UserText ===")
    for i, layer in enumerate(file3dm.Layers):
        layer_name = getattr(layer, "Name", None) or f"Layer {i}"
        if callable(layer_name):
            try:
                layer_name = layer_name()
            except:
                pass

        # 尝试读取图层的UserText
        has_usertext = False
        try:
            entries = _iter_user_strings(layer)
            if entries:
                has_usertext = True
                print(f"图层 {i} ({layer_name}) 有UserText:")
                for key, value in entries:
                    print(f"  {key} = {value}")
        except Exception:
            pass

        if not has_usertext:
            print(f"图层 {i} ({layer_name}): 无UserText")

    print("\n=== 检查对象UserText ===")
    objects_with_usertext = 0

    for idx, obj in enumerate(file3dm.Objects):
        geometry = obj.Geometry
        if geometry is None:
            continue

        # 获取图层信息
        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None

        # 获取几何体类型
        geom_type = type(geometry).__name__

        # 检查对象的UserText
        has_usertext = False
        usertext_data = {}

        if attributes:
            try:
                entries = _iter_user_strings(attributes)
                if entries:
                    has_usertext = True
                    for key, value in entries:
                        usertext_data[key] = value
            except Exception:
                pass

        if has_usertext:
            objects_with_usertext += 1
            print(f"\n对象 {idx} (图层{layer_index}, {geom_type}):")
            for key, value in usertext_data.items():
                print(f"  {key} = {value}")

    print(f"\n总结: {objects_with_usertext} 个对象有UserText")

    if objects_with_usertext == 0:
        print("\n警告: 没有找到任何对象级别的UserText!")
        print("请确认:")
        print("1. 选中对象（不是图层）")
        print("2. 打开属性面板（F3）")
        print("3. 在'属性用户文本'区域添加UserText")
        print("4. 保存模型")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python check_usertext_detailed.py <3dm文件路径>")
        sys.exit(1)

    model_path = sys.argv[1]
    if not Path(model_path).exists():
        print(f"错误: 文件不存在: {model_path}")
        sys.exit(1)

    check_usertext_detailed(model_path)
