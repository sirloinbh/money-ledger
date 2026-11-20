// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/layout/
import { BotIcon, RotateCcwIcon, SendIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { aiOrigin } from '../../lib/ai-chat';
import { AI_SHELL } from '../../lib/ai-config';
import { CURRENT_APP } from '../../lib/apps';
import { ROOT_DOMAIN } from '../../lib/auth-config';
import { type ToolCallView, useAiChat } from '../../lib/use-ai-chat';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Textarea } from '../ui/textarea';

// The AI shell (#612, ADR-0017): a chat panel opened from the top bar. It talks to shared-ai with the shared
// session cookie, shows each tool call with its app, and asks before any tool that changes data.
// It is hidden where there is no AI service (local, IP and foreign hosts).

const STATUS_TEXT: Record<ToolCallView['status'], string> = {
  waiting: 'Waiting for your answer',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  refused: 'Refused',
};

function ToolCall({ call, onAnswer }: { call: ToolCallView; onAnswer: (id: string, approve: boolean) => void }) {
  return (
    <li className="rounded-md border bg-muted/40 p-2 text-body-sm" data-slot="ai-tool-call">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">
          {call.app}: {call.tool}
        </span>
        <span className="text-caption text-muted-foreground">
          {call.readOnly ? 'read' : 'changes data'} · {STATUS_TEXT[call.status]}
        </span>
      </div>
      <pre className="mt-1 overflow-x-auto text-caption whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(call.input, null, 2)}
      </pre>
      {call.summary ? <p className="mt-1">{call.summary}</p> : null}
      {call.status === 'waiting' ? (
        <div className="mt-2 flex gap-2" role="group" aria-label={`Confirm ${call.tool}`}>
          <Button size="sm" onClick={() => onAnswer(call.id, true)}>
            Allow
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAnswer(call.id, false)}>
            Refuse
          </Button>
        </div>
      ) : null}
    </li>
  );
}

// The conversation and the draft live in AiShell, not here: the panel unmounts when it closes.
function ChatPanel({
  chat,
  draft,
  setDraft,
}: {
  chat: ReturnType<typeof useAiChat>;
  draft: string;
  setDraft: (value: string) => void;
}) {
  const { messages, busy, error, limit, send, answer, reset } = chat;
  const log = useRef<HTMLDivElement>(null);
  // Follow the newest text, unless the user scrolled up to read an earlier part.
  const following = useRef(true);
  useEffect(() => {
    const el = log.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [messages, error, limit]);

  const submit = () => {
    if (!draft.trim() || busy) return;
    void send(draft);
    setDraft('');
  };

  return (
    <>
      <div
        ref={log}
        onScroll={(event) => {
          const el = event.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex-1 space-y-3 overflow-y-auto px-4"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            Ask about the data in any app. I ask before I change anything.
          </p>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className={message.role === 'user' ? 'ml-8' : 'mr-4'}>
            <p className="text-caption text-muted-foreground">{message.role === 'user' ? 'You' : 'Assistant'}</p>
            {message.text ? <p className="text-body-sm whitespace-pre-wrap">{message.text}</p> : null}
            {message.calls.length > 0 ? (
              <ul className="mt-1 space-y-2">
                {message.calls.map((call) => (
                  <ToolCall key={call.id} call={call} onAnswer={(id, approve) => void answer(id, approve)} />
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {limit ? (
          <p role="status" className="rounded-md border border-destructive/50 p-2 text-body-sm">
            {limit}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md border border-destructive/50 p-2 text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <form
        className="flex items-end gap-2 border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          aria-label="Message"
          value={draft}
          rows={2}
          placeholder="Ask the assistant"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button type="submit" size="icon" aria-label="Send" aria-disabled={busy || !draft.trim()}>
          <SendIcon aria-hidden />
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="New conversation" onClick={reset}>
          <RotateCcwIcon aria-hidden />
        </Button>
      </form>
    </>
  );
}

// Closing the panel only hides it: the messages, a running answer and a pending confirmation stay with the button.
function AiShellPanel({ origin }: { origin: string }) {
  const { pathname } = useLocation();
  const chat = useAiChat(origin, { app: CURRENT_APP, page: pathname });
  const [draft, setDraft] = useState('');
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="AI assistant">
          <BotIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>AI assistant</SheetTitle>
          <SheetDescription className="sr-only">Chat with the assistant about the data in your apps</SheetDescription>
        </SheetHeader>
        <ChatPanel chat={chat} draft={draft} setDraft={setDraft} />
      </SheetContent>
    </Sheet>
  );
}

/** The top bar button and its panel. `origin` is for tests; the app derives it from its address. */
function AiShell({ origin }: { origin?: string | null }) {
  // An app turns the button on with features.aiShell; an explicit `origin` (tests) skips the flag.
  const resolved = origin !== undefined ? origin : AI_SHELL ? aiOrigin(window.location, ROOT_DOMAIN) : null;
  return resolved ? <AiShellPanel origin={resolved} /> : null;
}

export { AiShell };
