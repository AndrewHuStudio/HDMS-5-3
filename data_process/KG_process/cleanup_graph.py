"""
Standalone script to clean up long-tail nodes in the knowledge graph.

Usage:
    python -m data_process.KG_process.cleanup_graph [options]

Options:
    --remove-isolated       Remove nodes with no relationships
    --min-degree N          Remove nodes with degree < N (default: 1)
    --min-frequency N       Remove nodes appearing in < N documents (default: 2)
    --merge-similar         Merge entities with similar names
    --similarity FLOAT      Similarity threshold for merging (default: 0.9)
"""

import sys
import argparse
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

from ..core.database.manager import db_manager
from .entity_filter import create_graph_cleaner


def main():
    parser = argparse.ArgumentParser(
        description='Clean up long-tail nodes in knowledge graph'
    )
    parser.add_argument(
        '--remove-isolated',
        action='store_true',
        help='Remove nodes with no relationships'
    )
    parser.add_argument(
        '--min-degree',
        type=int,
        default=1,
        help='Remove nodes with degree < N (default: 1)'
    )
    parser.add_argument(
        '--min-frequency',
        type=int,
        default=0,
        help='Remove nodes appearing in < N documents (default: 0, disabled)'
    )
    parser.add_argument(
        '--merge-similar',
        action='store_true',
        help='Merge entities with similar names'
    )
    parser.add_argument(
        '--similarity',
        type=float,
        default=0.9,
        help='Similarity threshold for merging (default: 0.9)'
    )

    args = parser.parse_args()

    print('[INFO] Initializing database connections...')
    db_manager.initialize()

    print('[INFO] Creating graph cleaner...')
    cleaner = create_graph_cleaner(db_manager.neo4j)

    total_removed = 0

    # Remove isolated/low-degree nodes
    if args.remove_isolated or args.min_degree > 0:
        print(f'\n[INFO] Removing nodes with degree < {args.min_degree}...')
        removed = cleaner.remove_isolated_nodes(min_degree=args.min_degree)
        total_removed += removed
        print(f'[OK] Removed {removed} low-degree nodes')

    # Remove rare nodes
    if args.min_frequency > 0:
        print(f'\n[INFO] Removing nodes appearing in < {args.min_frequency} documents...')
        removed = cleaner.remove_nodes_by_frequency(min_frequency=args.min_frequency)
        total_removed += removed
        print(f'[OK] Removed {removed} rare nodes')

    # Merge similar names
    if args.merge_similar:
        print(f'\n[INFO] Merging entities with similarity >= {args.similarity}...')
        merged = cleaner.merge_similar_names(similarity_threshold=args.similarity)
        print(f'[OK] Merged {merged} similar entities')

    print(f'\n[SUCCESS] Cleanup complete! Total nodes removed: {total_removed}')

    # Show updated statistics
    print('\n[INFO] Updated graph statistics:')
    stats = db_manager.neo4j.get_statistics()
    print(f'  Total nodes: {stats.get("node_count", 0)}')
    print(f'  Total relationships: {stats.get("relationship_count", 0)}')


if __name__ == '__main__':
    main()
