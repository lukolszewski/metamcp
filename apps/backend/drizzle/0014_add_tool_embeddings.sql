-- Enable pgvector extension for vector operations
CREATE EXTENSION IF NOT EXISTS vector;

-- Create tool_embeddings table
CREATE TABLE IF NOT EXISTS tool_embeddings (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_uuid UUID NOT NULL REFERENCES tools(uuid) ON DELETE CASCADE,
  namespace_uuid UUID NOT NULL REFERENCES namespaces(uuid) ON DELETE CASCADE,
  model_name TEXT NOT NULL DEFAULT 'BAAI/bge-m3',
  embedding_dimensions INTEGER NOT NULL DEFAULT 1024,
  embedding vector(1024) NOT NULL,
  embedding_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Ensure one embedding per tool per namespace per model
  UNIQUE(tool_uuid, namespace_uuid, model_name)
);

-- Create indexes for fast lookups
CREATE INDEX tool_embeddings_namespace_idx ON tool_embeddings(namespace_uuid);
CREATE INDEX tool_embeddings_tool_idx ON tool_embeddings(tool_uuid);
CREATE INDEX tool_embeddings_model_idx ON tool_embeddings(model_name);

-- Create pgvector index for fast similarity search
-- IVFFlat: Inverted File with Flat compression
-- lists=100: Good starting point for 1000-10000 tools
-- vector_cosine_ops: Cosine distance operator (1 - cosine_similarity)
CREATE INDEX tool_embeddings_vector_idx ON tool_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Add comment for documentation
COMMENT ON TABLE tool_embeddings IS 'Stores vector embeddings for AI-powered tool search';
COMMENT ON COLUMN tool_embeddings.embedding IS 'Vector embedding from BAAI/bge-m3 model (1024 dimensions)';
COMMENT ON COLUMN tool_embeddings.embedding_text IS 'The text that was embedded (tool name + description + params)';
