import type { ResponsiveImageData, UnoptimizedImageData } from "@originloom/react/lib/media";
import type { ImgHTMLAttributes } from "react";

type Props = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height" | "loading" | "decoding" | "fetchPriority" | "sizes"
> & {
  image: ResponsiveImageData;
  /** Browser'ın slot genişliği hesabı. Responsive görsellerde zorunludur. */
  sizes: string;
  /** LCP adayı: eager + high fetch priority. Head preload route kontratında ayrıca tanımlanır. */
  priority?: boolean;
};

export function ResponsiveImage({ image, sizes, priority = false, alt, ...props }: Props) {
  return (
    <picture>
      {image.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={sizes} />
      ))}
      <img
        {...props}
        src={image.src}
        srcSet={image.srcSet}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </picture>
  );
}

type UnoptimizedProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height" | "loading" | "decoding" | "fetchPriority"
> & {
  image: UnoptimizedImageData;
  priority?: boolean;
};

/** Direct origin/CDN image. No format conversion, srcset generation or runtime proxy. */
export function UnoptimizedImage({ image, priority = false, alt, ...props }: UnoptimizedProps) {
  return (
    <img
      {...props}
      src={image.src}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
    />
  );
}
