import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface MarkdownPageProps {
  /** Page-level heading rendered above the card (the MD's h1 is suppressed). */
  title: string
  /** Optional subtitle line rendered below the title. */
  subtitle?: string
  /** Raw markdown string — import with Vite's `?raw` suffix. */
  content: string
  onBack: () => void
}

/**
 * Generic Vapor glass-card page that renders a raw markdown string.
 *
 * Consumers import their MD asset with Vite's `?raw` suffix:
 *   import content from '../../assets/content/faq.md?raw'
 *
 * Content updates are made exclusively in the MD file — this component
 * never needs to change for copy edits.
 */
export function MarkdownPage({ title, subtitle, content, onBack }: MarkdownPageProps) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-16 pt-24 sm:px-6 md:pb-20 md:pt-28 lg:px-8">
      <button
        onClick={onBack}
        className="mb-5 flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground sm:mb-8"
        aria-label="Back to Vapor"
      >
        ← Back
      </button>

      <article
        className="rounded-[1.75rem] border border-white/15 bg-background/72 p-5 text-[0.95rem] leading-7 text-muted-foreground shadow-[0_24px_80px_rgba(3,8,20,0.42)] backdrop-blur-xl sm:p-8 sm:text-base md:p-10 lg:p-12 lg:text-[1.05rem] lg:leading-8"
        aria-label={title}
      >
        <div className="mx-auto max-w-[78ch]">
          <h1 className="mb-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl lg:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mb-6 text-sm text-muted-foreground/80 sm:mb-8 sm:text-[0.95rem]">
              {subtitle}
            </p>
          )}

          <div className="mt-6 sm:mt-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </article>
    </div>
  )
}

/**
 * Tailwind class mappings for every markdown element.
 * The top-level h1 is suppressed — we render `title` ourselves above.
 */
const mdComponents: Components = {
  // Suppress the h1 from the MD file; we render the title prop instead.
  h1: () => null,

  h2: ({ children }) => (
    <h2 className="mb-3 mt-8 border-t border-white/10 pt-6 text-base font-semibold text-foreground first:mt-0 first:border-t-0 first:pt-0 sm:text-lg lg:text-[1.35rem]">
      {children}
    </h2>
  ),

  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-[0.95rem] font-medium text-foreground sm:text-base lg:text-lg">
      {children}
    </h3>
  ),

  p: ({ children }) => (
    <p className="mb-4 leading-7 last:mb-0 lg:leading-8">{children}</p>
  ),

  ul: ({ children }) => (
    <ul className="mb-4 list-inside list-disc space-y-1.5 last:mb-0">{children}</ul>
  ),

  ol: ({ children }) => (
    <ol className="mb-4 list-inside list-decimal space-y-1.5 last:mb-0">{children}</ol>
  ),

  li: ({ children }) => <li className="leading-7 lg:leading-8">{children}</li>,

  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),

  em: ({ children }) => <em className="italic">{children}</em>,

  code: ({ children }) => (
    <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[0.8rem] text-foreground sm:text-[0.875rem]">
      {children}
    </code>
  ),

  // GFM tables
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full min-w-[32rem] border-collapse text-sm sm:text-[0.95rem]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-white/20">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="py-3 pr-4 text-left font-medium text-foreground">{children}</th>
  ),
  td: ({ children }) => (
    <td className="py-2 pr-4 align-top">{children}</td>
  ),

  hr: () => <hr className="my-8 border-white/10" />,

  a: ({ children, href }) => (
    <a
      href={href}
      className="text-foreground underline decoration-white/30 underline-offset-4 transition-colors hover:text-foreground/80 hover:decoration-white/70"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
}
