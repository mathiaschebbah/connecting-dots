use anyhow::Result;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::sync::Mutex;

pub const EMBEDDING_DIM: usize = 384; // all-MiniLM-L6-v2

pub struct Embedder {
    model: Mutex<TextEmbedding>,
}

impl Embedder {
    pub fn new() -> Result<Self> {
        log::info!("Loading embedding model (all-MiniLM-L6-v2)...");
        let model = TextEmbedding::try_new(
            InitOptions::new(EmbeddingModel::AllMiniLML6V2).with_show_download_progress(true),
        )?;
        log::info!("Embedding model loaded.");
        Ok(Self {
            model: Mutex::new(model),
        })
    }

    /// Embed a single text, returns float[384]
    pub fn embed_one(&self, text: &str) -> Result<Vec<f32>> {
        let model = self.model.lock().unwrap();
        let mut results = model.embed(vec![text.to_string()], None)?;
        results
            .pop()
            .ok_or_else(|| anyhow::anyhow!("No embedding returned"))
    }

    /// Embed multiple texts in batch, returns Vec<float[384]>
    pub fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let model = self.model.lock().unwrap();
        let results = model.embed(texts.to_vec(), None)?;
        Ok(results)
    }
}
