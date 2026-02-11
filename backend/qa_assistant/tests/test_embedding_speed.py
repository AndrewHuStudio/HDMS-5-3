"""
Test script to measure embedding API response time.
Run this to quickly diagnose if embedding API is the bottleneck.
"""

import time
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.embedder import create_embedding_service


def test_embedding_speed():
    """Test embedding API response time with multiple queries."""

    print("=" * 60)
    print("Embedding API Speed Test")
    print("=" * 60)

    try:
        embedder = create_embedding_service()
        print(f"[OK] Embedding service created")
        print(f"    Model: {embedder.model}")
        print(f"    Base URL: {embedder.base_url}")
        print()
    except Exception as e:
        print(f"[FAIL] Failed to create embedding service: {e}")
        return

    test_queries = [
        "什么是容积率？",
        "如何进行退线检测？",
        "建筑限高的标准是什么？",
        "深超总地块的规划要求有哪些？",
        "城市设计管控的主要内容是什么？",
    ]

    print("Testing embedding API speed...")
    print("-" * 60)

    results = []

    for i, query in enumerate(test_queries, 1):
        print(f"\nTest {i}/{len(test_queries)}: {query}")

        # First call (no cache)
        start = time.perf_counter()
        try:
            embedding = embedder.embed_text(query)
            elapsed_ms = (time.perf_counter() - start) * 1000
            results.append(elapsed_ms)

            print(f"  [OK] First call: {elapsed_ms:.2f}ms")
            print(f"       Dimension: {len(embedding)}")

            # Second call (should hit cache)
            start = time.perf_counter()
            embedding = embedder.embed_text(query)
            cached_ms = (time.perf_counter() - start) * 1000
            print(f"  [OK] Cached call: {cached_ms:.2f}ms")

        except Exception as e:
            print(f"  [FAIL] Error: {e}")
            results.append(None)

    # Summary
    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)

    valid_results = [r for r in results if r is not None]

    if valid_results:
        avg_time = sum(valid_results) / len(valid_results)
        min_time = min(valid_results)
        max_time = max(valid_results)

        print(f"Total tests: {len(test_queries)}")
        print(f"Successful: {len(valid_results)}")
        print(f"Failed: {len(results) - len(valid_results)}")
        print()
        print(f"Average time: {avg_time:.2f}ms")
        print(f"Min time: {min_time:.2f}ms")
        print(f"Max time: {max_time:.2f}ms")
        print()

        # Diagnosis
        print("Diagnosis:")
        if avg_time < 500:
            print("  [OK] Embedding API is fast (< 500ms)")
            print("       The 5-10s delay is likely NOT from embedding API")
        elif avg_time < 2000:
            print("  [WARNING] Embedding API is moderate (500-2000ms)")
            print("            This could contribute to delays")
        else:
            print("  [PROBLEM] Embedding API is SLOW (> 2000ms)")
            print("            This is likely the main cause of 5-10s delay")
            print()
            print("  Recommended actions:")
            print("  1. Check network connection to API endpoint")
            print("  2. Try a smaller embedding model (text-embedding-3-small)")
            print("  3. Consider using local embedding model")
            print("  4. For simple queries, skip retrieval (STREAM_RETRIEVAL_MODE=none)")
    else:
        print("[FAIL] All tests failed. Check your API configuration.")

    print("=" * 60)


if __name__ == "__main__":
    test_embedding_speed()
