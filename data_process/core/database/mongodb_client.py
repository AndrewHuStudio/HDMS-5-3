"""
MongoDB document database client for HDMS.
"""

from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure
from typing import List, Dict, Any, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class MongoDBClient:
    """Client for interacting with MongoDB document database."""

    def __init__(self, uri: str, database: str):
        """
        Initialize MongoDB client.

        Args:
            uri: MongoDB connection URI
            database: Database name
        """
        self.uri = uri
        self.database_name = database
        self.client: Optional[MongoClient] = None
        self.db = None

    def connect(self) -> None:
        """Establish connection to MongoDB server."""
        try:
            self.client = MongoClient(self.uri, serverSelectionTimeoutMS=5000)
            # Test connection
            self.client.admin.command("ping")
            self.db = self.client[self.database_name]
            logger.info(f"Connected to MongoDB database: {self.database_name}")
        except ConnectionFailure as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise

    def disconnect(self) -> None:
        """Disconnect from MongoDB server."""
        if self.client:
            self.client.close()
            self.client = None
            self.db = None
            logger.info("Disconnected from MongoDB")

    def insert_document(self, collection: str, document: Dict[str, Any]) -> str:
        """
        Insert a single document.

        Args:
            collection: Collection name
            document: Document to insert

        Returns:
            Inserted document ID as string
        """
        try:
            result = self.db[collection].insert_one(document)
            logger.info(f"Inserted document into {collection}: {result.inserted_id}")
            return str(result.inserted_id)
        except OperationFailure as e:
            logger.error(f"Failed to insert document: {e}")
            raise

    def insert_many(self, collection: str, documents: List[Dict[str, Any]]) -> List[str]:
        """
        Insert multiple documents.

        Args:
            collection: Collection name
            documents: List of documents to insert

        Returns:
            List of inserted document IDs as strings
        """
        if not documents:
            return []
        try:
            result = self.db[collection].insert_many(documents)
            logger.info(f"Inserted {len(documents)} documents into {collection}")
            return [str(doc_id) for doc_id in result.inserted_ids]
        except OperationFailure as e:
            logger.error(f"Failed to insert documents: {e}")
            raise

    def find_by_id(self, collection: str, doc_id: str) -> Optional[Dict[str, Any]]:
        """
        Find a document by ID.

        Args:
            collection: Collection name
            doc_id: Document ID

        Returns:
            Document if found, None otherwise
        """
        return self.db[collection].find_one({"_id": doc_id})

    def find_by_query(
        self,
        collection: str,
        query: Dict[str, Any],
        limit: Optional[int] = 10,
        projection: Optional[Dict[str, Any]] = None,
        sort: Optional[List[Tuple[str, int]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Find documents by query.

        Args:
            collection: Collection name
            query: MongoDB query filter
            limit: Maximum number of results
            projection: Fields to include/exclude
            sort: Optional sort expression, e.g. [("updated_at", -1)]

        Returns:
            List of matching documents
        """
        cursor = self.db[collection].find(query, projection)
        if sort:
            cursor = cursor.sort(sort)
        if limit is not None:
            cursor = cursor.limit(limit)
        return list(cursor)

    def find_one(
        self,
        collection: str,
        query: Dict[str, Any],
        projection: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Find a single document by query.

        Args:
            collection: Collection name
            query: MongoDB query filter
            projection: Fields to include/exclude

        Returns:
            First matching document or None
        """
        return self.db[collection].find_one(query, projection)

    def update_document(
        self,
        collection: str,
        doc_id: str,
        update: Dict[str, Any]
    ) -> bool:
        """
        Update a document by ID.

        Args:
            collection: Collection name
            doc_id: Document ID
            update: Update operations

        Returns:
            True if document was updated, False otherwise
        """
        result = self.db[collection].update_one(
            {"_id": doc_id},
            {"$set": update}
        )
        return result.modified_count > 0

    def upsert_document(
        self,
        collection: str,
        doc_id: str,
        update: Dict[str, Any],
        set_on_insert: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        Upsert a document by ID.

        Args:
            collection: Collection name
            doc_id: Document ID
            update: Fields to set
            set_on_insert: Optional fields set only when inserting

        Returns:
            True if a document was inserted or modified
        """
        payload: Dict[str, Any] = {"$set": update}
        if set_on_insert:
            payload["$setOnInsert"] = set_on_insert
        result = self.db[collection].update_one({"_id": doc_id}, payload, upsert=True)
        return bool(result.modified_count or result.upserted_id)

    def delete_document(self, collection: str, doc_id: str) -> bool:
        """
        Delete a document by ID.

        Args:
            collection: Collection name
            doc_id: Document ID

        Returns:
            True if document was deleted, False otherwise
        """
        result = self.db[collection].delete_one({"_id": doc_id})
        return result.deleted_count > 0

    def delete_many(self, collection: str, query: Dict[str, Any]) -> int:
        """
        Delete multiple documents by query.

        Args:
            collection: Collection name
            query: MongoDB query filter

        Returns:
            Number of documents deleted
        """
        result = self.db[collection].delete_many(query or {})
        return int(result.deleted_count or 0)

    def count_documents(self, collection: str, query: Optional[Dict[str, Any]] = None) -> int:
        """
        Count documents matching query.

        Args:
            collection: Collection name
            query: MongoDB query filter (None for all documents)

        Returns:
            Number of matching documents
        """
        return self.db[collection].count_documents(query or {})

    def create_text_index(self, collection: str, fields: List[str]) -> None:
        """
        Create a text index for full-text search.

        Args:
            collection: Collection name
            fields: List of field names to index
        """
        index_spec = [(field, "text") for field in fields]
        self.db[collection].create_index(index_spec)
        logger.info(f"Created text index on {collection} for fields: {fields}")

    def text_search(
        self,
        collection: str,
        query: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Perform full-text search.

        Args:
            collection: Collection name
            query: Search query string
            limit: Maximum number of results

        Returns:
            List of matching documents
        """
        cursor = self.db[collection].find(
            {"$text": {"$search": query}},
            {"score": {"$meta": "textScore"}}
        ).sort([("score", {"$meta": "textScore"})]).limit(limit)
        return list(cursor)
