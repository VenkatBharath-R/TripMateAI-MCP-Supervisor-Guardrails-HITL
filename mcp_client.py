
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

import certifi
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_mcp_adapters.client import MultiServerMCPClient


PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env", override=False)

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

AVIATION_STACK_API_KEY = (
    os.getenv("AVIATION_STACK_API_KEY")
    or os.getenv("AVIATIONSTACK_API_KEY")
)

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

WEATHER_SERVER_PATH = PROJECT_DIR / "custom_weather_mcpserver.py"
UVX_COMMAND = shutil.which("uvx") or "uvx"


def _require_env(name: str, value: str | None) -> str:
    """Raise a clear error when a required API key is missing."""

    if not value:
        raise RuntimeError(
            f"{name} is missing. Add {name}=your_key "
            "to the project's .env file."
        )

    return value


def _subprocess_env(**updates: str | None) -> dict[str, str]:
    """Keep the current environment and add MCP server API keys."""

    env = os.environ.copy()

    for key, value in updates.items():
        if value:
            env[key] = value

    return env


# =========================================================
# GROQ LLM
# =========================================================

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    api_key=GROQ_API_KEY,
)


# =========================================================
# MCP CLIENT CONFIGURATION
# =========================================================

client = MultiServerMCPClient(
    {
        "tavily": {
            "transport": "streamable_http",
            "url": (
                "https://mcp.tavily.com/mcp/"
                f"?tavilyApiKey={TAVILY_API_KEY or ''}"
            ),
        },
        "aviationstack": {
            "transport": "stdio",
            "command": UVX_COMMAND,
            "args": [
                "aviationstack-mcp",
            ],
            "env": _subprocess_env(
                AVIATION_STACK_API_KEY=AVIATION_STACK_API_KEY,
            ),
        },
        "weather": {
            "transport": "stdio",
            "command": sys.executable,
            "args": [
                str(WEATHER_SERVER_PATH),
            ],
            "env": _subprocess_env(
                OPENWEATHER_API_KEY=OPENWEATHER_API_KEY,
            ),
        },
    }
)


# =========================================================
# LOAD A SPECIFIC MCP TOOL
# =========================================================

async def _get_server_tool(
    server_name: str,
    tool_name: str,
):
    """Load one requested tool without requiring other MCP servers."""

    if server_name == "tavily":
        _require_env("TAVILY_API_KEY", TAVILY_API_KEY)

    elif server_name == "aviationstack":
        _require_env(
            "AVIATION_STACK_API_KEY",
            AVIATION_STACK_API_KEY,
        )

        if shutil.which("uvx") is None:
            raise RuntimeError(
                "uvx was not found. Install uv, reopen the terminal, "
                "activate your project environment, and check "
                "with: uvx --version"
            )

    elif server_name == "weather":
        _require_env(
            "OPENWEATHER_API_KEY",
            OPENWEATHER_API_KEY,
        )

        if not WEATHER_SERVER_PATH.is_file():
            raise FileNotFoundError(
                f"Weather MCP server not found: {WEATHER_SERVER_PATH}"
            )

    tools = await client.get_tools(server_name=server_name)

    selected_tool = next(
        (tool for tool in tools if tool.name == tool_name),
        None,
    )

    if selected_tool is None:
        available = ", ".join(
            sorted(tool.name for tool in tools)
        ) or "none"

        raise RuntimeError(
            f"Tool '{tool_name}' was not found on "
            f"server '{server_name}'. Available tools: {available}"
        )

    return selected_tool


# =========================================================
# MCP CONNECTION TEST
# =========================================================

async def get_all_tools() -> None:
    """Check each MCP server separately so one failure doesn't hide others."""

    for server_name in ("tavily", "aviationstack", "weather"):
        try:
            tools = await client.get_tools(
                server_name=server_name
            )

            names = ", ".join(
                tool.name for tool in tools
            ) or "no tools found"

            print(f"{server_name}: OK -> {names}")

        except Exception as exc:
            print(
                f"{server_name}: FAILED -> "
                f"{type(exc).__name__}: {exc}"
            )


# =========================================================
# TAVILY SEARCH
# =========================================================

async def tavily_mcp_search(query: str):
    search_tool = await _get_server_tool(
        "tavily",
        "tavily_search",
    )

    return await search_tool.ainvoke(
        {"query": query}
    )


# =========================================================
# AVIATIONSTACK
# =========================================================

async def aviation_mcp_call(
    tool_name: str,
    tool_args: dict[str, Any] | None = None,
):
    aviation_tool = await _get_server_tool(
        "aviationstack",
        tool_name,
    )

    return await aviation_tool.ainvoke(
        tool_args or {}
    )


# =========================================================
# CURRENT WEATHER
# =========================================================

async def weather_mcp_search(city: str):
    weather_tool = await _get_server_tool(
        "weather",
        "get_current_weather",
    )

    return await weather_tool.ainvoke(
        {"city": city}
    )


# =========================================================
# WEATHER FORECAST
# =========================================================

async def forecast_mcp_search(city: str):
    forecast_tool = await _get_server_tool(
        "weather",
        "get_forecast",
    )

    return await forecast_tool.ainvoke(
        {"city": city}
    )


# =========================================================
# DESTINATION EXTRACTION
# =========================================================

def extract_destination(query: str) -> str:
    """
    Extract a destination from a travel or weather query.
    Use simple text patterns first, then try Groq as a fallback.
    """

    text = query.strip()

    patterns = [
        r"\b(?:weather|forecast|climate)\s+(?:in|for|at)\s+([A-Za-z][A-Za-z .'-]{1,60})",
        r"\b(?:trip|travel|journey|vacation|holiday)\s+to\s+([A-Za-z][A-Za-z .'-]{1,60})",
        r"\b(?:visit|explore|go to)\s+([A-Za-z][A-Za-z .'-]{1,60})",
        r"\bto\s+([A-Za-z][A-Za-z .'-]{1,60})",
    ]

    stop_words = (
        r"\b(?:for|during|with|and|from|under|within|"
        r"next week|tomorrow|today|this weekend|"
        r"next month|next year)\b"
    )

    for pattern in patterns:
        match = re.search(
            pattern,
            text,
            flags=re.IGNORECASE,
        )

        if not match:
            continue

        candidate = match.group(1).strip(" .,!?:;")

        candidate = re.split(
            stop_words,
            candidate,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip(" .,!?:;")

        if candidate:
            return candidate[:80]

    # Fallback: ask Groq to extract the destination.
    prompt = (
        "Extract only the destination city or country from this "
        "travel request. Return only the destination name.\n"
        f"Request: {text[:700]}"
    )

    try:
        response = llm.invoke(prompt)
        destination = (
            str(response.content)
            .strip()
            .strip('"')
            .strip("'")
        )

        if destination:
            return destination[:80]

    except Exception as exc:
        print(
            "Destination extraction fallback used: "
            f"{type(exc).__name__}: {exc}"
        )

    # Avoid crashing if Groq is temporarily unavailable.
    return text[:80] or "Unknown destination"
