// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/markdown/
import type * as React from 'react';
import { useMemo } from 'react';

import { cn } from '../../lib/utils';
import { type Block, type Inline, parseBlocks } from './parse';

type HeadingTag = 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

// Shows user-written Markdown safely (#19). The text is turned into React elements by a small parser (parse.ts) and
// never into HTML, so a writer cannot add markup, images, scripts or event handlers; raw HTML in the text appears as
// plain text. Links are only http(s) and open in a new tab. The supported syntax is listed in markdown.md.
//
// `headingStart` is the tag a `#` heading becomes (default `h2`, because the page's own title is the `h1`); `##`
// becomes the next level, and so on up to `h6`.
function Markdown({
  children,
  headingStart = 2,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  children: string;
  headingStart?: 2 | 3 | 4;
}) {
  const blocks = useMemo(() => parseBlocks(children), [children]);
  return (
    <div
      data-slot="markdown"
      className={cn('flex flex-col gap-3 text-body break-words', className)}
      {...props}
    >
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} headingStart={headingStart} />
      ))}
    </div>
  );
}

function BlockView({ block, headingStart }: { block: Block; headingStart: number }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, headingStart + block.level - 1)}` as HeadingTag;
      return (
        <Tag className="mt-2 first:mt-0">
          <InlineView nodes={block.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p>
          <InlineView nodes={block.children} />
        </p>
      );
    case 'quote':
      return (
        <blockquote className="flex flex-col gap-3 border-l-4 border-border pl-4 text-muted-foreground">
          {block.children.map((child, index) => (
            <BlockView key={index} block={child} headingStart={headingStart} />
          ))}
        </blockquote>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          className={cn('flex flex-col gap-1 pl-6', block.ordered ? 'list-decimal' : 'list-disc')}
        >
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineView nodes={item} />
            </li>
          ))}
        </List>
      );
    }
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-body-sm">
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr className="border-border" />;
  }
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'text':
            return node.text;
          case 'break':
            return <br key={index} />;
          case 'strong':
            return (
              <strong key={index} className="font-semibold">
                <InlineView nodes={node.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <InlineView nodes={node.children} />
              </em>
            );
          case 'code':
            return (
              <code key={index} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-body-sm">
                {node.text}
              </code>
            );
          case 'link':
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer rounded-sm text-primary underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <InlineView nodes={node.children} />{' '}
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            );
        }
      })}
    </>
  );
}

export { Markdown };
