import type { Blog } from "~/lib/contracts/blogs";

export type PopularBlogsProps = {
  posts: Blog[];
};

export function PopularBlogsWidget({ posts }: PopularBlogsProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-neutral-900">
        🔥 En Çok Okunan Bloglar (Fragment Cached)
      </h3>
      <ul className="space-y-4">
        {posts.map((post) => (
          <li
            key={post.id}
            className="group flex flex-col gap-1 border-b border-neutral-100 pb-3 last:border-0 last:pb-0"
          >
            <a
              href={`/blogs/${post.slug}`}
              className="text-sm font-semibold text-neutral-800 transition-colors hover:text-blue-600"
            >
              {post.title}
            </a>
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>{post.author}</span>
              <span>•</span>
              <span>{post.readTimeMin} dk okuma</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
