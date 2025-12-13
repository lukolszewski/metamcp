// Modifications Copyright (c) 2025 Łukasz Olszewski
// Licensed under the GNU Affero General Public License v3.0
// See LICENSE for details.

interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class EmbeddingClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model: string = 'BAAI/bge-m3',
    baseUrl: string = 'http://localhost:11434/v1'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  /**
   * Generate embeddings for multiple texts
   * API supports up to 100 texts per request
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (texts.length > 100) {
      throw new Error('Maximum 100 texts per batch. Use batching for larger sets.');
    }

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Embeddings API error: ${response.status} ${response.statusText}\n${errorText}`
        );
      }

      const data: EmbeddingResponse = await response.json();

      // Sort by index to ensure correct order
      const embeddings = data.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);

      console.log(
        `[Embeddings] Generated ${embeddings.length} embeddings, ` +
        `used ${data.usage.prompt_tokens} tokens`
      );

      return embeddings;

    } catch (error) {
      console.error('[Embeddings] Embedding generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateSingleEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    return embeddings[0];
  }

  /**
   * Get the dimension size for the current model
   */
  getModelDimensions(): number {
    const dimensionMap: Record<string, number> = {
      'BAAI/bge-m3': 1024,
      'BAAI/bge-large-en-v1.5': 1024,
      'BAAI/bge-base-en-v1.5': 768,
      'BAAI/bge-small-en-v1.5': 384,
      'jina-embeddings-v3': 1024,
      'text-embedding-3-small': 1536,
    };

    return dimensionMap[this.model] ?? 1024; // Default to 1024
  }
}

/**
 * Cosine similarity helper (for fallback if pgvector not available)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

  // Handle edge cases
  if (isNaN(similarity)) return 0;
  return similarity;
}
