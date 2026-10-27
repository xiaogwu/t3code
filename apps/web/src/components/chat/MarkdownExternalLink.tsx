import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { GlobeIcon, ListTodoIcon } from "lucide-react";
import { Children, Fragment, memo, useState, type ReactNode } from "react";

import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";

import { cn } from "../../lib/utils";
import { sourceControlIcon } from "../../sourceControlPresentation";

const MARKDOWN_LINK_FAVICON_CLASS_NAME = "block size-full shrink-0 select-none";

const failedFaviconHosts = new Set<string>();

/**
 * The rem-open bridge's origin (`~/.claude/tools/rem-open-bridge`). A click there opens a
 * Reminders task, so the whole origin — port included — is the match: `127.0.0.1` on its own is
 * every local dev server.
 */
const REMINDERS_BRIDGE_ORIGIN = "http://127.0.0.1:17429/";

/** Marks whose glyph (drawn in `currentColor`) replaces the fetched favicon so it follows the theme. */
function brandLinkIcon(host: string, href: string | undefined): ReactNode {
  if (href?.startsWith(REMINDERS_BRIDGE_ORIGIN)) {
    return <ListTodoIcon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />;
  }
  return sourceControlHostIcon(host);
}

function sourceControlHostIcon(host: string): ReactNode {
  const definition = sourceControlClients.findByPublicDomain(host);
  if (definition === undefined) return null;
  const Icon = sourceControlIcon(definition);
  return <Icon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />;
}

const MarkdownLinkFavicon = memo(function MarkdownLinkFavicon({
  host,
  href,
}: {
  host: string;
  href: string | undefined;
}) {
  const [failedHost, setFailedHost] = useState<string | null>(null);
  const brandIcon = brandLinkIcon(host, href);
  const faviconUrl = brandIcon ? null : faviconUrlForOrigin(`https://${host}`);
  return (
    <span
      className="ms-[0.25em] me-[0.2em] inline-flex size-[14px] [vertical-align:-0.125em]"
      aria-hidden
    >
      {brandIcon ? (
        brandIcon
      ) : faviconUrl === null || failedHost === host || failedFaviconHosts.has(host) ? (
        <GlobeIcon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />
      ) : (
        <img
          src={faviconUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className={cn(MARKDOWN_LINK_FAVICON_CLASS_NAME, "rounded-sm")}
          onError={() => {
            failedFaviconHosts.add(host);
            setFailedHost(host);
          }}
        />
      )}
    </span>
  );
});

function leadingExternalLinkTextLength(text: string): number {
  const protocol = /^(?:https?:\/\/)/i.exec(text)?.[0];
  if (protocol) return protocol.length;
  return Math.min(text.length, 1);
}

/**
 * Splits a URL where a line may break: before each run of `/ . ? # & = - _ ~ %`,
 * so a wrapped line starts with the delimiter the way style guides break URLs.
 * A segment too long for the line still falls back to the root `overflow-wrap`.
 */
export function externalLinkBreakSegments(text: string): string[] {
  return text.match(/[/.?#&=\-_~%]*[^/.?#&=\-_~%]*/g)?.filter((segment) => segment !== "") ?? [];
}

function breakableExternalLinkText(text: string): ReactNode[] {
  let offset = 0;
  return externalLinkBreakSegments(text).map((segment) => {
    const start = offset;
    offset += segment.length;
    return (
      <Fragment key={start}>
        {start > 0 ? <wbr /> : null}
        {segment}
      </Fragment>
    );
  });
}

export function MarkdownExternalLinkContent({
  host,
  href,
  plainText,
  children,
}: {
  host: string;
  href: string | undefined;
  plainText: string | null;
  children: ReactNode;
}) {
  if (plainText) {
    const leadingLength = leadingExternalLinkTextLength(plainText);
    return (
      <>
        <span className="whitespace-nowrap">
          <MarkdownLinkFavicon host={host} href={href} />
          {plainText.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(plainText.slice(leadingLength))}
      </>
    );
  }

  const childNodes = Children.toArray(children);
  const firstChild = childNodes[0];

  if (typeof firstChild === "string" && firstChild.length > 0) {
    const leadingLength = leadingExternalLinkTextLength(firstChild);
    return (
      <>
        <span className="whitespace-nowrap">
          <MarkdownLinkFavicon host={host} href={href} />
          {firstChild.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(firstChild.slice(leadingLength))}
        {childNodes.slice(1)}
      </>
    );
  }

  return (
    <>
      <span className="whitespace-nowrap">
        <MarkdownLinkFavicon host={host} href={href} />
        {firstChild}
      </span>
      {childNodes.slice(1)}
    </>
  );
}
