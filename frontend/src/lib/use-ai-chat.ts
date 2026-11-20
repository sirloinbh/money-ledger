// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ChatContext,
  ChatError,
  type ChatEvent,
  confirmToolCall,
  streamChat,
  type ToolCallInfo,
} from './ai-chat';

// State of one AI shell conversation (#612): messages, tool calls and the confirmation step.

export type ToolCallStatus = 'waiting' | 'running' | 'done' | 'failed' | 'refused';

export type ToolCallView = ToolCallInfo & { status: ToolCallStatus; summary?: string };

export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  calls: ToolCallView[];
};

/** Applies one stream event to the assistant message being built. */
function applyEvent(message: ChatMessage, event: ChatEvent): ChatMessage {
  switch (event.type) {
    case 'text':
      return { ...message, text: message.text + event.delta };
    case 'tool_call': {
      const { type: _type, ...info } = event;
      return {
        ...message,
        calls: [...message.calls, { ...info, status: info.readOnly ? 'running' : 'waiting' }],
      };
    }
    case 'tool_result':
      return {
        ...message,
        calls: message.calls.map((call) =>
          call.id === event.id
            ? {
                ...call,
                status: event.ok ? 'done' : call.status === 'refused' ? 'refused' : 'failed',
                summary: event.summary,
              }
            : call,
        ),
      };
    default:
      return message;
  }
}

export function useAiChat(origin: string, context: ChatContext) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const nextId = useRef(1);
  const abort = useRef<AbortController | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => () => abort.current?.abort(), []);

  const updateLast = useCallback((fn: (message: ChatMessage) => ChatMessage) => {
    setMessages((all) => (all.length === 0 ? all : [...all.slice(0, -1), fn(all[all.length - 1])]));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setError(null);
      setLimit(null);
      setBusy(true);
      setMessages((all) => [
        ...all,
        { id: nextId.current++, role: 'user', text: message, calls: [] },
        { id: nextId.current++, role: 'assistant', text: '', calls: [] },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        await streamChat({
          origin,
          conversationId: conversationId.current,
          message,
          context: contextRef.current,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'done') conversationId.current = event.conversationId;
            else if (event.type === 'limit') setLimit(event.message);
            else if (event.type === 'error') setError(event.message);
            else updateLast((last) => applyEvent(last, event));
          },
        });
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof ChatError ? caught.message : 'Something went wrong');
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, origin, updateLast],
  );

  const answer = useCallback(
    async (callId: string, approve: boolean) => {
      const id = conversationId.current;
      if (!id) return;
      const patch = (status: ToolCallStatus) =>
        setMessages((all) =>
          all.map((m) => ({ ...m, calls: m.calls.map((c) => (c.id === callId ? { ...c, status } : c)) })),
        );
      patch(approve ? 'running' : 'refused');
      try {
        await confirmToolCall({ origin, conversationId: id, callId, approve });
      } catch (caught) {
        patch('failed');
        setError(caught instanceof ChatError ? caught.message : 'Something went wrong');
      }
    },
    [origin],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    conversationId.current = undefined;
    setMessages([]);
    setError(null);
    setLimit(null);
    setBusy(false);
  }, []);

  return { messages, busy, error, limit, send, answer, reset };
}
