CREATE VIRTUAL TABLE posts_fts USING fts5(
	title,
	body,
	content='posts',
	content_rowid='id',
	tokenize='unicode61'
);
--> statement-breakpoint
CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts BEGIN
	INSERT INTO posts_fts(rowid, title, body)
	VALUES (new.id, coalesce(new.title, ''), new.body);
END;
--> statement-breakpoint
INSERT INTO posts_fts(posts_fts) VALUES ('rebuild');
