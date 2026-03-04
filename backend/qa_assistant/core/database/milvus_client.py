"""
Milvus vector database client for HDMS.
"""

from pymilvus import connections, Collection, FieldSchema, CollectionSchema, DataType, utility
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class MilvusClient:
    """Client for interacting with Milvus vector database."""

    def __init__(self, host: str, port: int):
        """
        Initialize Milvus client.

        Args:
            host: Milvus server host
            port: Milvus server port
        """
        self.host = host
        self.port = port
        self.connection_alias = "default"
        self._connected = False

    def connect(self) -> None:
        """Establish connection to Milvus server."""
        candidate_hosts = [self.host]
        if self.host == "localhost":
            candidate_hosts.append("127.0.0.1")

        last_error: Exception | None = None
        for candidate_host in dict.fromkeys(candidate_hosts):
            try:
                connections.disconnect(alias=self.connection_alias)
            except Exception:
                pass

            try:
                connections.connect(
                    alias=self.connection_alias,
                    host=candidate_host,
                    port=str(self.port)
                )
                self._connected = True
                self.host = candidate_host
                logger.info(f"Connected to Milvus at {candidate_host}:{self.port}")
                return
            except Exception as exc:
                last_error = exc
                logger.warning(f"Failed to connect to Milvus at {candidate_host}:{self.port}: {exc}")

        if last_error:
            logger.error(f"Failed to connect to Milvus: {last_error}")
            raise last_error

    def disconnect(self) -> None:
        """Disconnect from Milvus server."""
        if self._connected:
            connections.disconnect(alias=self.connection_alias)
            self._connected = False
            logger.info("Disconnected from Milvus")

    def get_collection_dimension(self, collection_name: str) -> Optional[int]:
        """
        Get embedding dimension for an existing collection.

        Args:
            collection_name: Name of the collection

        Returns:
            Dimension of embedding vectors, or None if not available.
        """
        if not utility.has_collection(collection_name):
            return None
        collection = Collection(collection_name)
        for field in collection.schema.fields:
            if field.name != "embedding":
                continue
            params = getattr(field, "params", {}) or {}
            dim = params.get("dim") or params.get("dimension")
            if dim is None:
                return None
            try:
                return int(dim)
            except Exception:
                return None
        return None

    def create_collection(
        self,
        collection_name: str,
        dimension: int,
        recreate_on_mismatch: bool = False,
        strict: bool = True
    ) -> Collection:
        """
        Create a new collection for storing document chunks.

        Args:
            collection_name: Name of the collection
            dimension: Dimension of embedding vectors
            recreate_on_mismatch: Drop and recreate collection when dimension mismatch
            strict: Raise error on dimension mismatch when not recreating

        Returns:
            Created collection object
        """
        if utility.has_collection(collection_name):
            existing_dim = self.get_collection_dimension(collection_name)
            if existing_dim and existing_dim != dimension:
                msg = (
                    f"Collection {collection_name} dimension mismatch: "
                    f"existing {existing_dim}, expected {dimension}."
                )
                if recreate_on_mismatch:
                    logger.warning(f"{msg} Recreating collection.")
                    self.delete_collection(collection_name)
                elif strict:
                    raise ValueError(
                        f"{msg} Set MILVUS_RECREATE_ON_MISMATCH=1 to recreate, "
                        "or align EMBEDDING_MODEL/EMBEDDING_DIMENSION."
                    )
                else:
                    logger.warning(msg)
                    return Collection(collection_name)
            else:
                logger.info(f"Collection {collection_name} already exists")
                return Collection(collection_name)

        # Define schema
        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=100, is_primary=True),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=dimension),
            FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=200),
            FieldSchema(name="chunk_index", dtype=DataType.INT64),
            FieldSchema(name="metadata", dtype=DataType.JSON),
        ]

        schema = CollectionSchema(
            fields=fields,
            description="HDMS document chunks with embeddings"
        )

        collection = Collection(name=collection_name, schema=schema)

        # Create IVF_FLAT index for efficient similarity search
        index_params = {
            "metric_type": "COSINE",
            "index_type": "IVF_FLAT",
            "params": {"nlist": 1024}
        }
        collection.create_index(field_name="embedding", index_params=index_params)

        logger.info(f"Created collection {collection_name} with dimension {dimension}")
        return collection

    def insert_vectors(
        self,
        collection_name: str,
        data: List[Dict[str, Any]]
    ) -> None:
        """
        Insert vectors into collection.

        Args:
            collection_name: Name of the collection
            data: List of dictionaries containing id, embedding, text, doc_id, chunk_index, metadata
        """
        collection = Collection(collection_name)

        # Prepare data in columnar format
        ids = [item["id"] for item in data]
        embeddings = [item["embedding"] for item in data]
        texts = [item["text"] for item in data]
        doc_ids = [item["doc_id"] for item in data]
        chunk_indices = [item["chunk_index"] for item in data]
        metadatas = [item["metadata"] for item in data]

        entities = [ids, embeddings, texts, doc_ids, chunk_indices, metadatas]

        collection.insert(entities)
        collection.flush()

        logger.info(f"Inserted {len(data)} vectors into {collection_name}")

    def delete_by_expr(self, collection_name: str, expr: str) -> int:
        """
        Delete vectors by expression.

        Args:
            collection_name: Name of the collection
            expr: Milvus boolean expression

        Returns:
            Number of entities deleted (if available)
        """
        if not expr:
            return 0
        collection = Collection(collection_name)
        result = collection.delete(expr)
        collection.flush()
        deleted = getattr(result, "delete_count", None)
        return int(deleted or 0)

    def delete_by_doc_ids(self, collection_name: str, doc_ids: List[str]) -> int:
        """
        Delete vectors by document IDs.

        Args:
            collection_name: Name of the collection
            doc_ids: List of document IDs

        Returns:
            Number of entities deleted (if available)
        """
        if not doc_ids:
            return 0
        quoted = ", ".join([f"\"{doc_id}\"" for doc_id in doc_ids])
        expr = f"doc_id in [{quoted}]"
        return self.delete_by_expr(collection_name, expr)

    def search(
        self,
        collection_name: str,
        query_vector: List[float],
        top_k: int = 5,
        filter_expr: Optional[str] = None,
        *,
        load_timeout: Optional[float] = None,
        search_timeout: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search for similar vectors.

        Args:
            collection_name: Name of the collection
            query_vector: Query embedding vector
            top_k: Number of results to return
            filter_expr: Optional filter expression
            load_timeout: Optional timeout for collection.load()
            search_timeout: Optional timeout for collection.search()

        Returns:
            List of search results with id, text, doc_id, chunk_index, metadata, and distance
        """
        collection = Collection(collection_name)
        collection.load(timeout=load_timeout)

        search_params = {
            "metric_type": "COSINE",
            "params": {"nprobe": 10}
        }

        results = collection.search(
            data=[query_vector],
            anns_field="embedding",
            param=search_params,
            limit=top_k,
            expr=filter_expr,
            output_fields=["id", "text", "doc_id", "chunk_index", "metadata"],
            timeout=search_timeout,
        )

        # Format results
        formatted_results = []
        for hits in results:
            for hit in hits:
                formatted_results.append({
                    "id": hit.entity.get("id"),
                    "text": hit.entity.get("text"),
                    "doc_id": hit.entity.get("doc_id"),
                    "chunk_index": hit.entity.get("chunk_index"),
                    "metadata": hit.entity.get("metadata"),
                    "distance": hit.distance
                })

        logger.info(f"Found {len(formatted_results)} results for query")
        return formatted_results

    def delete_collection(self, collection_name: str) -> None:
        """
        Delete a collection.

        Args:
            collection_name: Name of the collection to delete
        """
        if utility.has_collection(collection_name):
            utility.drop_collection(collection_name)
            logger.info(f"Deleted collection {collection_name}")

    def get_collection_stats(self, collection_name: str) -> Dict[str, Any]:
        """
        Get statistics for a collection.

        Args:
            collection_name: Name of the collection

        Returns:
            Dictionary with collection statistics
        """
        if not utility.has_collection(collection_name):
            return {"exists": False}

        collection = Collection(collection_name)
        collection.load()
        dimension = self.get_collection_dimension(collection_name)

        return {
            "exists": True,
            "num_entities": collection.num_entities,
            "name": collection_name,
            "dimension": dimension
        }
