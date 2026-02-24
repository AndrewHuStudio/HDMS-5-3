import { describe, expect, it } from "vitest";
import {
  buildGraphProgressRows,
  computeGraphPanelStats,
  type GraphProgressRow,
} from "./graph-progress";

describe("buildGraphProgressRows", () => {
  it("matches built document by doc_id even when file_name differs", () => {
    const rows = buildGraphProgressRows(
      [
        {
          doc_id: "doc-1",
          file_name: "全时利用导则",
          markdown_path: "x",
          status: "complete",
        },
      ],
      [
        {
          doc_id: "doc-1",
          file_name: "全时利用导则.pdf",
          status: "success",
          entities_count: 10,
          relationships_count: 20,
        },
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fileName: "全时利用导则.pdf",
      status: "success",
      entitiesCount: 10,
      relationshipsCount: 20,
    });
  });

  it("treats skipped as success", () => {
    const rows = buildGraphProgressRows(
      [
        {
          doc_id: "doc-2",
          file_name: "后海局部导引",
          markdown_path: "x",
          status: "complete",
        },
      ],
      [
        {
          doc_id: "doc-2",
          file_name: "后海局部导引",
          status: "skipped",
          entities_count: 0,
          relationships_count: 0,
        },
      ]
    );

    expect(rows[0].status).toBe("success");
  });
});

describe("computeGraphPanelStats", () => {
  it("does not fall back to doc_count when progress rows exist", () => {
    const progressRows: GraphProgressRow[] = [
      {
        key: "1",
        fileName: "A",
        status: "pending",
        entitiesCount: null,
        relationshipsCount: null,
      },
      {
        key: "2",
        fileName: "B",
        status: "pending",
        entitiesCount: null,
        relationshipsCount: null,
      },
    ];

    const stats = computeGraphPanelStats(progressRows, {
      doc_count: 22,
      total_nodes: 0,
      total_relationships: 0,
      entity_counts: {},
      entity_types: [],
    });

    expect(stats.statSuccess).toBe(0);
    expect(stats.statDocs).toBe(2);
  });
});
