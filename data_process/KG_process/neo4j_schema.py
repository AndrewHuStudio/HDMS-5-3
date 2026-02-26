"""
Neo4j database initialization script for knowledge graph.

Creates constraints and indexes for Chinese entity labels and English relationship types.
"""

# ---------------------------------------------------------------------------
# Constraints (Uniqueness)
# ---------------------------------------------------------------------------

CONSTRAINTS = [
    # 空间层级类
    "CREATE CONSTRAINT IF NOT EXISTS FOR (n:地块) REQUIRE n.name IS UNIQUE;",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (n:片区) REQUIRE n.name IS UNIQUE;",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (n:空间要素) REQUIRE n.name IS UNIQUE;",

    # 管控规则类
    "CREATE CONSTRAINT IF NOT EXISTS FOR (n:法规) REQUIRE n.name IS UNIQUE;",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (n:标准) REQUIRE n.name IS UNIQUE;",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (n:导则) REQUIRE n.name IS UNIQUE;",
]

# ---------------------------------------------------------------------------
# Indexes (Performance)
# ---------------------------------------------------------------------------

INDEXES = [
    # Name indexes for all entity types (6 types)
    "CREATE INDEX IF NOT EXISTS FOR (n:地块) ON (n.name);",
    "CREATE INDEX IF NOT EXISTS FOR (n:片区) ON (n.name);",
    "CREATE INDEX IF NOT EXISTS FOR (n:空间要素) ON (n.name);",
    "CREATE INDEX IF NOT EXISTS FOR (n:法规) ON (n.name);",
    "CREATE INDEX IF NOT EXISTS FOR (n:标准) ON (n.name);",
    "CREATE INDEX IF NOT EXISTS FOR (n:导则) ON (n.name);",

    # Property indexes for common attributes
    "CREATE INDEX IF NOT EXISTS FOR (n:地块) ON (n.far);",
    "CREATE INDEX IF NOT EXISTS FOR (n:地块) ON (n.height_limit);",
    "CREATE INDEX IF NOT EXISTS FOR (n:地块) ON (n.source_doc);",
    "CREATE INDEX IF NOT EXISTS FOR (n:片区) ON (n.source_doc);",
]

# ---------------------------------------------------------------------------
# Full-text indexes (Concept search)
# ---------------------------------------------------------------------------

FULLTEXT_INDEXES = [
    # Concept search across key entity types (6 types)
    """
    CREATE FULLTEXT INDEX concept_search IF NOT EXISTS
    FOR (n:片区|地块|空间要素|法规|标准|导则)
    ON EACH [n.name, n.description]
    """,
]

# ---------------------------------------------------------------------------
# Helper function to execute all initialization
# ---------------------------------------------------------------------------

def initialize_neo4j_schema(neo4j_client):
    """
    Initialize Neo4j schema with constraints and indexes.

    Args:
        neo4j_client: Neo4jClient instance
    """
    print("Initializing Neo4j schema...")

    # Create constraints
    print(f"Creating {len(CONSTRAINTS)} constraints...")
    for constraint in CONSTRAINTS:
        try:
            neo4j_client.query(constraint)
            print(f"  [OK] {constraint[:50]}...")
        except Exception as e:
            print(f"  [FAIL] {e}")

    # Create indexes
    print(f"Creating {len(INDEXES)} indexes...")
    for index in INDEXES:
        try:
            neo4j_client.query(index)
            print(f"  [OK] {index[:50]}...")
        except Exception as e:
            print(f"  [FAIL] {e}")

    # Create full-text indexes
    print(f"Creating {len(FULLTEXT_INDEXES)} full-text indexes...")
    for ft_index in FULLTEXT_INDEXES:
        try:
            neo4j_client.query(ft_index)
            print(f"  [OK] Full-text index created")
        except Exception as e:
            print(f"  [FAIL] {e}")

    print("Neo4j schema initialization complete!")


# ---------------------------------------------------------------------------
# Migration script (if needed to update from old schema)
# ---------------------------------------------------------------------------

MIGRATION_QUERIES = [
    # Rename old English labels to Chinese (if migrating from old schema)
    # Note: This is destructive and should be run carefully

    # Example: Rename Plot to 地块
    # "MATCH (n:Plot) SET n:地块 REMOVE n:Plot;",

    # Example: Rename District to 片区
    # "MATCH (n:District) SET n:片区 REMOVE n:District;",

    # Add more migration queries as needed
]

def migrate_schema(neo4j_client, dry_run=True):
    """
    Migrate from old schema to new schema.

    Args:
        neo4j_client: Neo4jClient instance
        dry_run: If True, only print queries without executing
    """
    print("Schema migration...")
    print(f"Dry run: {dry_run}")

    for query in MIGRATION_QUERIES:
        if dry_run:
            print(f"  [DRY RUN] {query}")
        else:
            try:
                neo4j_client.query(query)
                print(f"  [OK] {query[:50]}...")
            except Exception as e:
                print(f"  [FAIL] {e}")

    if dry_run:
        print("Dry run complete. Set dry_run=False to execute migration.")
    else:
        print("Migration complete!")
