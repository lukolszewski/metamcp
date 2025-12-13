-- Add search_mode column to endpoints table
ALTER TABLE "endpoints"
ADD COLUMN "search_mode" TEXT NOT NULL DEFAULT 'keyword';

-- Add check constraint to ensure valid values
ALTER TABLE "endpoints"
ADD CONSTRAINT "endpoints_search_mode_check"
CHECK (search_mode IN ('keyword', 'embeddings'));

-- Add comment
COMMENT ON COLUMN "endpoints"."search_mode"
IS 'Search mode for smart mode: keyword (fast, basic) or embeddings (AI-powered)';
