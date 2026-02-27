import { describe, expect, it } from 'vitest';
import { buildReport } from '@/features/data-upload/verification-panel';
import type { ConsistencyRepairResponse, HealthDbResponse } from '@/features/data-upload/types';

describe('buildReport', () => {
  it('does not include orphan-data check item', () => {
    const healthDb: HealthDbResponse = {
      status: 'ok',
      databases: {
        milvus: { exists: true, num_entities: 10 },
        mongodb: { documents: 2, chunks: 10 },
        neo4j: { node_count: 8, relationship_count: 12 },
      },
    };

    const consistency: ConsistencyRepairResponse = {
      dry_run: true,
      target_docs: 2,
      mongo_documents: 2,
      mongo_chunks: 10,
      milvus_vectors_scanned: 10,
      graph_documents: 2,
      orphan_chunks: 5,
      orphan_vectors: 3,
      orphan_graph_documents: 1,
      inconsistent_docs: [],
      repaired: {
        deleted_orphan_chunks: 0,
        deleted_orphan_vectors: 0,
        deleted_orphan_graph_docs: 0,
        deleted_orphan_graph_entities: 0,
        cleaned_inconsistent_docs: 0,
      },
    };

    const report = buildReport(healthDb, consistency, null, null);

    expect(report.checks.map((check) => check.id)).not.toContain('orphans');
    expect(report.checks.map((check) => check.label)).not.toContain('无孤儿数据');
    expect(report.checks).toHaveLength(6);
  });
});
