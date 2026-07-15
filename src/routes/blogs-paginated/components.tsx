import type { Blog } from "../../services/blogs";

const styles = {
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "1.25rem 1.5rem",
    background: "#fff",
  },
  title: { margin: "0 0 0.5rem", fontSize: "1.125rem" },
  excerpt: { margin: "0 0 1rem", color: "#475569", lineHeight: 1.6 },
  meta: { display: "flex", gap: "0.75rem", flexWrap: "wrap" as const, fontSize: "0.875rem", color: "#64748b" },
  tag: {
    display: "inline-block",
    padding: "0.125rem 0.5rem",
    borderRadius: 999,
    background: "#f1f5f9",
    color: "#334155",
    fontSize: "0.75rem",
  },
} as const;

export function BlogCard({ blog }: { blog: Blog }) {
  const date = new Date(blog.publishedAt).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <article style={styles.card}>
      <h2 style={styles.title}>{blog.title}</h2>
      <p style={styles.excerpt}>{blog.excerpt}</p>
      <div style={styles.meta}>
        <span>{blog.author}</span>
        <span>·</span>
        <time dateTime={blog.publishedAt}>{date}</time>
        <span>·</span>
        <span>{blog.readTimeMin} dk okuma</span>
      </div>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
        {blog.tags.map((tag) => (
          <span key={tag} style={styles.tag}>
            #{tag}
          </span>
        ))}
      </div>
    </article>
  );
}

export function BlogList({ posts }: { posts: Blog[] }) {
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {posts.map((blog) => (
        <BlogCard key={blog.id} blog={blog} />
      ))}
    </div>
  );
}

export function PageSummary({
  page,
  totalPages,
  total,
}: {
  page: number;
  totalPages: number;
  total: number;
}) {
  return (
    <p style={{ color: "#64748b", margin: "0 0 1.25rem" }}>
      Sayfa {page} / {totalPages} — toplam {total} yazı
    </p>
  );
}
