import { describe, expect, it } from 'vitest';
import { getDisplayEntityTypes } from '@/features/data-upload/graph-upload-panel';

describe('getDisplayEntityTypes', () => {
  it('keeps only Chinese graph entity labels', () => {
    const labels = ['地块', '片区', 'Plot', 'Document', '标准', 'Topic', 'Indicator'];

    expect(getDisplayEntityTypes(labels)).toEqual(['地块', '片区', '标准']);
  });
});
