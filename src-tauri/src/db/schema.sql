-- Tweets
CREATE TABLE IF NOT EXISTS tweets (
    id TEXT PRIMARY KEY,
    author_id TEXT,
    author_handle TEXT NOT NULL,
    author_name TEXT,
    author_verified INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    created_at TEXT,
    conversation_id TEXT,
    language TEXT,
    tweet_url TEXT,
    reply_to_id TEXT,
    reply_to_handle TEXT,
    is_retweet INTEGER DEFAULT 0,
    retweeted_by TEXT,
    media_json TEXT,
    quoted_tweet_json TEXT,
    likes INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    replies_count INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    bookmarks_count INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    source TEXT DEFAULT 'bookmark',
    fetched_at TEXT NOT NULL,
    raw_json TEXT,
    -- Embedding (phase 1: local, fastembed-rs)
    embedding BLOB,
    -- AI metadata (phase 2: Claude API, async)
    ai_category TEXT,
    ai_summary TEXT,
    ai_topics TEXT,
    ai_type TEXT,
    ai_enriched_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts USING fts5(
    content, author_handle, author_name,
    content='tweets',
    content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS tweets_ai AFTER INSERT ON tweets BEGIN
    INSERT INTO tweets_fts(rowid, content, author_handle, author_name)
    VALUES (new.rowid, new.content, new.author_handle, new.author_name);
END;

CREATE TRIGGER IF NOT EXISTS tweets_ad AFTER DELETE ON tweets BEGIN
    INSERT INTO tweets_fts(tweets_fts, rowid, content, author_handle, author_name)
    VALUES ('delete', old.rowid, old.content, old.author_handle, old.author_name);
END;

CREATE TRIGGER IF NOT EXISTS tweets_au AFTER UPDATE ON tweets BEGIN
    INSERT INTO tweets_fts(tweets_fts, rowid, content, author_handle, author_name)
    VALUES ('delete', old.rowid, old.content, old.author_handle, old.author_name);
    INSERT INTO tweets_fts(rowid, content, author_handle, author_name)
    VALUES (new.rowid, new.content, new.author_handle, new.author_name);
END;

-- Tweet interactions
CREATE TABLE IF NOT EXISTS tweet_replies (
    tweet_id TEXT REFERENCES tweets(id),
    reply_id TEXT,
    author_handle TEXT,
    content TEXT,
    created_at TEXT,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (tweet_id, reply_id)
);

CREATE TABLE IF NOT EXISTS tweet_quotes (
    tweet_id TEXT REFERENCES tweets(id),
    quote_id TEXT,
    author_handle TEXT,
    content TEXT,
    created_at TEXT,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (tweet_id, quote_id)
);

CREATE TABLE IF NOT EXISTS tweet_metrics (
    tweet_id TEXT REFERENCES tweets(id),
    likes INTEGER,
    retweets INTEGER,
    replies INTEGER,
    views INTEGER,
    recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tweet_notes (
    id INTEGER PRIMARY KEY,
    tweet_id TEXT REFERENCES tweets(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tweet_links (
    source_id TEXT REFERENCES tweets(id),
    target_id TEXT REFERENCES tweets(id),
    link_type TEXT DEFAULT 'related',
    strength REAL DEFAULT 1.0,
    PRIMARY KEY (source_id, target_id)
);

-- Organization
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    color TEXT
);

CREATE TABLE IF NOT EXISTS tweet_groups (
    tweet_id TEXT REFERENCES tweets(id),
    group_id INTEGER REFERENCES groups(id),
    PRIMARY KEY (tweet_id, group_id)
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    color TEXT
);

CREATE TABLE IF NOT EXISTS tweet_tags (
    tweet_id TEXT REFERENCES tweets(id),
    tag_id INTEGER REFERENCES tags(id),
    PRIMARY KEY (tweet_id, tag_id)
);

-- Kanban
CREATE TABLE IF NOT EXISTS kanban_columns (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    name TEXT NOT NULL,
    position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kanban_cards (
    id INTEGER PRIMARY KEY,
    column_id INTEGER REFERENCES kanban_columns(id),
    tweet_id TEXT REFERENCES tweets(id),
    note TEXT,
    position INTEGER NOT NULL
);

-- Pinned accounts
CREATE TABLE IF NOT EXISTS pinned_accounts (
    handle TEXT PRIMARY KEY,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    pinned_since TEXT NOT NULL,
    poll_interval_secs INTEGER DEFAULT 300,
    last_polled_at TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS project_accounts (
    project_id INTEGER REFERENCES projects(id),
    account_handle TEXT REFERENCES pinned_accounts(handle),
    PRIMARY KEY (project_id, account_handle)
);

CREATE TABLE IF NOT EXISTS account_interactions (
    source_handle TEXT,
    target_handle TEXT,
    interaction_type TEXT,
    count INTEGER DEFAULT 1,
    last_seen_at TEXT,
    PRIMARY KEY (source_handle, target_handle, interaction_type)
);
