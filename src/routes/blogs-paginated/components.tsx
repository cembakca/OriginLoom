import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import type { Blog } from "~/lib/contracts/blogs";

export function BlogCard({ blog }: { blog: Blog }) {
  const date = new Date(blog.publishedAt).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Card className="hover:border-brand-200 hover:shadow-md transition-all">
      <CardHeader>
        <CardTitle className="text-xl leading-snug">{blog.title}</CardTitle>
        <CardDescription className="line-clamp-2">{blog.excerpt}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <span>{blog.author}</span>
          <span>·</span>
          <time dateTime={blog.publishedAt}>{date}</time>
          <span>·</span>
          <span>{blog.readTimeMin} dk</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {blog.tags.map((tag) => (
            <Badge key={tag} className="bg-slate-100 text-slate-700">
              #{tag}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function BlogList({ posts }: { posts: Blog[] }) {
  return (
    <div className="grid gap-4">
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
    <p className="mb-6 text-sm text-slate-500">
      Sayfa {page} / {totalPages} — toplam {total} yazı
    </p>
  );
}
