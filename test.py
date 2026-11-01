
import os
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

api_key = os.getenv("GROQ_API_KEY", "").strip()

if not api_key:
    print("ERROR: GROQ_API_KEY is missing.")
else:
    try:
        client = Groq(api_key=api_key)

        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "user", "content": "Reply with API key works"}
            ],
            max_tokens=20,
        )

        print("SUCCESS:", response.choices[0].message.content)

    except Exception as e:
        print("FAILED:", type(e).__name__)
        print("DETAILS:", e)
