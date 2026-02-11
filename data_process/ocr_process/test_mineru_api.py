"""
测试 MinerU API 连接
用于验证 API Key 和端点是否正确
"""
import json
import urllib.request
import urllib.error
from pathlib import Path

# 从 .env 读取配置
def load_env():
    env_path = Path(__file__).parents[3] / ".env"
    config = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                config[key.strip()] = value.strip().strip("\"'")
    return config

config = load_env()
API_KEY = config.get("MINERU_API_KEY", "")
BASE_URL = config.get("MINERU_BASE_URL", "https://mineru.net/api/v4")

print("=" * 60)
print("MinerU API 连接测试")
print("=" * 60)
print(f"API Key: {API_KEY[:20]}...{API_KEY[-20:]}")
print(f"Base URL: {BASE_URL}")
print("=" * 60)

# 测试 1: 检查 API Key 格式
print("\n[测试 1] 检查 API Key 格式")
if not API_KEY:
    print("[FAIL] API Key 未设置")
    exit(1)
elif not API_KEY.startswith("eyJ"):
    print("[FAIL] API Key 格式不正确（应该以 eyJ 开头）")
    exit(1)
else:
    print("[OK] API Key 格式正确")

# 测试 2: 测试文件上传 URL 请求
print("\n[测试 2] 请求文件上传 URL")
file_urls_endpoint = f"{BASE_URL}/file-urls/batch"
print(f"端点: {file_urls_endpoint}")

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}

payload = {
    "files": [
        {
            "name": "test.pdf",
            "data_id": "test_123",
            "is_ocr": True,
            "model_version": "vlm",
        }
    ]
}

print(f"请求头: {json.dumps({k: v[:50] + '...' if len(v) > 50 else v for k, v in headers.items()}, indent=2, ensure_ascii=False)}")
print(f"请求体: {json.dumps(payload, indent=2, ensure_ascii=False)}")

try:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(file_urls_endpoint, data=data, headers=headers, method="POST")

    print("\n发送请求...")
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8")
        result = json.loads(body)

        print(f"\n[OK] 响应状态码: {response.status}")
        print(f"响应内容: {json.dumps(result, indent=2, ensure_ascii=False)}")

        # 检查响应格式
        if result.get("code") in (0, 200):
            print("\n[OK] API 返回成功")
            data = result.get("data", {})
            batch_id = data.get("batch_id")
            file_urls = data.get("file_urls") or data.get("files")

            if batch_id:
                print(f"[OK] 获取到 batch_id: {batch_id}")
            else:
                print("[FAIL] 响应中没有 batch_id")

            if file_urls:
                print(f"[OK] 获取到上传 URL: {len(file_urls)} 个")
            else:
                print("[FAIL] 响应中没有 file_urls")
        else:
            print(f"\n[FAIL] API 返回错误: code={result.get('code')}, msg={result.get('msg')}")

except urllib.error.HTTPError as e:
    print(f"\n[FAIL] HTTP 错误: {e.code}")
    try:
        error_body = e.read().decode("utf-8")
        print(f"错误详情: {error_body}")
    except:
        print(f"错误详情: {e}")
except urllib.error.URLError as e:
    print(f"\n[FAIL] 网络错误: {e}")
except Exception as e:
    print(f"\n[FAIL] 未知错误: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("测试完成")
print("=" * 60)
