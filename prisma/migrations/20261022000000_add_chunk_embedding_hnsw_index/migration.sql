-- CreateIndex
-- HNSW index for cosine-distance (<=>) similarity search on chunk embeddings.
-- m = 16: neighbors per node (higher = more accurate, more memory)
-- ef_construction = 64: build-time search breadth (higher = better index, slower build)
CREATE INDEX IF NOT EXISTS "Chunk_embedding_hnsw_idx" ON "Chunk"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
