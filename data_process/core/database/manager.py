"""
Database manager for initializing and managing database connections.
"""

from typing import Optional
import logging
from .milvus_client import MilvusClient
from .mongodb_client import MongoDBClient
from .neo4j_client import Neo4jClient
from .. import config

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Manager for all database connections."""

    def __init__(self):
        """Initialize database manager."""
        self.milvus: Optional[MilvusClient] = None
        self.mongodb: Optional[MongoDBClient] = None
        self.neo4j: Optional[Neo4jClient] = None
        self._initialized = False

    def initialize(self) -> None:
        """Initialize all database connections."""
        if self._initialized:
            logger.warning("Database manager already initialized")
            return

        try:
            # Initialize Milvus
            logger.info("Initializing Milvus connection...")
            self.milvus = MilvusClient(
                host=config.MILVUS_HOST,
                port=config.MILVUS_PORT
            )
            self.milvus.connect()

            # Create text chunks collection if it doesn't exist
            self.milvus.create_collection(
                collection_name=config.MILVUS_COLLECTION_TEXT,
                dimension=config.EMBEDDING_DIMENSION,
                recreate_on_mismatch=config.MILVUS_RECREATE_ON_MISMATCH,
                strict=config.MILVUS_DIMENSION_STRICT
            )

            # Initialize MongoDB
            logger.info("Initializing MongoDB connection...")
            self.mongodb = MongoDBClient(
                uri=config.MONGODB_URI,
                database=config.MONGODB_DATABASE
            )
            self.mongodb.connect()

            # Create text indexes for full-text search
            try:
                self.mongodb.create_text_index("documents", ["full_text", "file_name"])
                self.mongodb.create_text_index("chunks", ["text"])
            except Exception as e:
                logger.warning(f"Text indexes may already exist: {e}")

            # Initialize Neo4j
            logger.info("Initializing Neo4j connection...")
            self.neo4j = Neo4jClient(
                uri=config.NEO4J_URI,
                user=config.NEO4J_USER,
                password=config.NEO4J_PASSWORD
            )
            self.neo4j.connect()

            # Create constraints for unique properties
            try:
                self.neo4j.create_constraint("Plot", "name")
                self.neo4j.create_constraint("Document", "doc_id")
            except Exception as e:
                logger.warning(f"Constraints may already exist: {e}")

            self._initialized = True
            logger.info("All database connections initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize databases: {e}")
            self.cleanup()
            raise

    def cleanup(self) -> None:
        """Close all database connections."""
        if self.milvus:
            try:
                self.milvus.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting from Milvus: {e}")

        if self.mongodb:
            try:
                self.mongodb.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting from MongoDB: {e}")

        if self.neo4j:
            try:
                self.neo4j.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting from Neo4j: {e}")

        self._initialized = False
        logger.info("Database connections closed")

    def get_stats(self) -> dict:
        """
        Get statistics from all databases.

        Returns:
            Dictionary with statistics from each database
        """
        stats = {}

        if self.milvus:
            try:
                stats["milvus"] = self.milvus.get_collection_stats(config.MILVUS_COLLECTION_TEXT)
            except Exception as e:
                stats["milvus"] = {"error": str(e)}

        if self.mongodb:
            try:
                stats["mongodb"] = {
                    "documents": self.mongodb.count_documents("documents"),
                    "chunks": self.mongodb.count_documents("chunks")
                }
            except Exception as e:
                stats["mongodb"] = {"error": str(e)}

        if self.neo4j:
            try:
                stats["neo4j"] = self.neo4j.get_statistics()
            except Exception as e:
                stats["neo4j"] = {"error": str(e)}

        return stats


# Global database manager instance
db_manager = DatabaseManager()
