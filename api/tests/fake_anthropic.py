"""A scripted stand-in for `anthropic.Anthropic().messages`.

Implements only what `SqlAgent` touches — which is the point of typing that
dependency as a narrow Protocol. Lets the whole agent loop, including the
guard and real database execution, be tested without an API key.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TextBlock:
    text: str
    type: str = "text"


@dataclass
class ToolUseBlock:
    input: dict
    id: str = "toolu_test"
    name: str = "run_sql"
    type: str = "tool_use"


@dataclass
class Usage:
    input_tokens: int = 100
    output_tokens: int = 50
    cache_read_input_tokens: int = 0


@dataclass
class FakeResponse:
    content: list
    stop_reason: str = "end_turn"
    usage: Usage = field(default_factory=Usage)


def says(text: str) -> FakeResponse:
    return FakeResponse(content=[TextBlock(text)])


def runs_sql(sql: str, *, tool_id: str = "toolu_1", preamble: str | None = None) -> FakeResponse:
    content: list = []
    if preamble:
        content.append(TextBlock(preamble))
    content.append(ToolUseBlock(input={"sql": sql}, id=tool_id))
    return FakeResponse(content=content, stop_reason="tool_use")


def refuses() -> FakeResponse:
    return FakeResponse(content=[], stop_reason="refusal")


class ScriptedClient:
    """Returns queued responses in order and records every request.

    Requests are deep-copied on capture. The agent appends to the same
    `messages` list across turns, so storing the reference would leave every
    recorded call pointing at the final state — making an assertion about
    "what was sent on call 2" silently inspect the end of the conversation.
    A real HTTP client serialises at call time; this mirrors that.
    """

    def __init__(self, *responses: FakeResponse) -> None:
        self._queue = list(responses)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> FakeResponse:
        self.calls.append(copy.deepcopy(kwargs))
        if not self._queue:
            raise AssertionError("agent made more model calls than the script provided")
        return self._queue.pop(0)
