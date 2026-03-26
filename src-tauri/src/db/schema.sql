-- Bookmarks
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
    bookmark_order INTEGER,
    fetched_at TEXT NOT NULL,
    raw_json TEXT,
    ai_category TEXT,
    ai_cluster TEXT,
    ai_summary TEXT,
    ai_topics TEXT,
    ai_type TEXT,
    ai_enriched_at TEXT,
    author_avatar TEXT,
    resolved_content TEXT,
    resolved_author TEXT,
    resolved_url TEXT
);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts USING fts5(
    content, author_handle, author_name,
    content='tweets',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS tweets_ai AFTER INSERT ON tweets BEGIN
    INSERT INTO tweets_fts(rowid, content, author_handle, author_name)
    VALUES (new.rowid, COALESCE(new.resolved_content, new.content), new.author_handle, new.author_name);
END;

CREATE TRIGGER IF NOT EXISTS tweets_ad AFTER DELETE ON tweets BEGIN
    INSERT INTO tweets_fts(tweets_fts, rowid, content, author_handle, author_name)
    VALUES ('delete', old.rowid, COALESCE(old.resolved_content, old.content), old.author_handle, old.author_name);
END;

CREATE TRIGGER IF NOT EXISTS tweets_au AFTER UPDATE ON tweets BEGIN
    INSERT INTO tweets_fts(tweets_fts, rowid, content, author_handle, author_name)
    VALUES ('delete', old.rowid, COALESCE(old.resolved_content, old.content), old.author_handle, old.author_name);
    INSERT INTO tweets_fts(rowid, content, author_handle, author_name)
    VALUES (new.rowid, COALESCE(new.resolved_content, new.content), new.author_handle, new.author_name);
END;

-- Dots (nested topic clusters)
CREATE TABLE IF NOT EXISTS dots (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    parent_id INTEGER REFERENCES dots(id),
    description TEXT,
    color TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tweet_dots (
    tweet_id TEXT REFERENCES tweets(id),
    dot_id INTEGER REFERENCES dots(id),
    PRIMARY KEY (tweet_id, dot_id)
);

CREATE TABLE IF NOT EXISTS correction_patterns (
    id INTEGER PRIMARY KEY,
    rule_text TEXT NOT NULL,
    source_corrections INTEGER NOT NULL DEFAULT 0,
    last_triggered_at TEXT,
    effectiveness REAL DEFAULT 0.0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS corrections (
    id INTEGER PRIMARY KEY,
    tweet_id TEXT REFERENCES tweets(id),
    action TEXT NOT NULL,
    from_dot_slug TEXT,
    to_dot_slug TEXT,
    tweet_summary TEXT,
    tweet_topics TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    retired_at TEXT,
    pattern_id INTEGER REFERENCES correction_patterns(id)
);

-- Tags
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

-- Notes
CREATE TABLE IF NOT EXISTS tweet_notes (
    id INTEGER PRIMARY KEY,
    tweet_id TEXT REFERENCES tweets(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
