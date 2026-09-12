# Gemma 3 Chatbot

A modern, multimodal AI chatbot built with **Streamlit** and **Amazon Bedrock**, powered by Google's **Gemma 3** model.

The application provides real-time streaming conversations, persistent chat history, search across previous conversations, document and image uploads, and optional live web search context.

---

## Overview

**Gemma 3 Chatbot** is an interactive AI assistant designed to demonstrate the integration of Google's Gemma 3 model with Amazon Bedrock and a Streamlit-based user interface.

The application supports both text-based conversations and multimodal prompts, allowing users to upload images alongside their messages. It also provides document-based context and optional web search enrichment.

### Core Architecture

```text
                ┌──────────────────────┐
                │      Streamlit UI    │
                └──────────┬───────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
       Text Chat      File Upload    Image Upload
            │              │              │
            │              ▼              │
            │       Local Processing      │
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                 ┌──────────────────┐
                 │  Amazon Bedrock  │
                 │     Gemma 3      │
                 └────────┬─────────┘
                          │
                          ▼
                  Streaming Response
```

---

## Key Features

- 🤖 Google Gemma 3 integration through Amazon Bedrock
- ⚡ Real-time streaming chat responses
- 💬 Persistent conversation history
- 🔎 Search across previous conversations
- 🌐 Optional live web search context
- 📄 PDF document upload
- 📝 DOCX document upload
- 📃 TXT document upload
- 📊 CSV document upload
- 📑 TSV document upload
- 🗂️ JSON document upload
- 🖼️ Image upload for multimodal prompts
- 💾 Local conversation storage
- 🔐 Environment-based AWS configuration

---

## Technology Stack

| Technology | Purpose |
|---|---|
| **Python** | Application development |
| **Streamlit** | Interactive web interface |
| **Amazon Bedrock** | Managed AI model platform |
| **Google Gemma 3** | Large language model |
| **Bedrock Converse API** | Model interaction |
| **Bedrock `converse_stream`** | Real-time response streaming |
| **DuckDuckGo** | Lightweight web search context |
| **JSON** | Local conversation storage |

---

## Supported Files

The chatbot supports uploading the following document formats:

| File Type | Supported |
|---|---|
| PDF | ✅ |
| DOCX | ✅ |
| TXT | ✅ |
| CSV | ✅ |
| TSV | ✅ |
| JSON | ✅ |
| Images | ✅ |

Uploaded documents are processed locally and used as context for retrieval-style answers. :contentReference[oaicite:1]{index=1}

---

## Core Functionality

### 🤖 Gemma 3 AI Chat

The chatbot uses Google's Gemma 3 model through Amazon Bedrock to generate conversational responses.

The default documented model configuration is:

```text
google.gemma-3-12b-it
```

---

### ⚡ Streaming Responses

The application uses Amazon Bedrock's `converse_stream` functionality to provide responses in real time.

Instead of waiting for the complete response, users can see the assistant's response as it is generated. :contentReference[oaicite:2]{index=2}

---

### 💬 Persistent Conversation History

Conversation history is maintained so users can continue their conversations without losing previous messages during normal application usage.

The application also stores conversation history locally in:

```text
data/conversations.json
```

:contentReference[oaicite:3]{index=3}

---

### 🔎 Search Past Conversations

Users can search across previously stored conversations to quickly find earlier discussions and information.

This makes the chatbot more useful for maintaining a long-term collection of local conversations.

---

### 🌐 Optional Web Search

The chatbot can optionally enrich responses with live web context.

The documented implementation uses DuckDuckGo's public instant-answer endpoint as a lightweight default for web search. :contentReference[oaicite:4]{index=4}

Web search is optional and can be used when additional external context is useful.

---

### 📄 Document Understanding

Users can upload supported documents and use their content as additional context for questions.

The application locally chunks uploaded documents and uses the resulting content as prompt context for retrieval-style answers. :contentReference[oaicite:5]{index=5}

---

### 🖼️ Multimodal Image Prompts

The chatbot supports image uploads, allowing images to be included in multimodal interactions with the Gemma 3 model.

This extends the application beyond traditional text-only chatbot functionality.

---

## How the Application Works

The general workflow is:

```text
User Input
    │
    ├── Text
    │
    ├── Documents
    │
    └── Images
          │
          ▼
   Local Processing
          │
          ▼
 Optional Web Context
          │
          ▼
   Prompt Construction
          │
          ▼
   Amazon Bedrock
          │
          ▼
     Gemma 3 Model
          │
          ▼
 Streaming Response
          │
          ▼
 Conversation History
```

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/DarshanS2004/Gemma-3-Chatbot.git
cd Gemma-3-Chatbot
```

### 2. Create a Virtual Environment

#### Windows

```powershell
python -m venv .venv
.venv\Scripts\activate
```

#### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## AWS / Amazon Bedrock Configuration

Create a local `.env` file using `.env.example` as a template.

Example:

```env
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=google.gemma-3-12b-it
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_SESSION_TOKEN=
AWS_BEARER_TOKEN=
```

The project documentation identifies these environment variables for configuration. :contentReference[oaicite:6]{index=6}

---

## Running the Application

Start the Streamlit application with:

```bash
streamlit run app.py
```

The application will provide a local web interface for interacting with the chatbot.

---

## Usage

### Step 1 — Start the Application

Run:

```bash
streamlit run app.py
```

### Step 2 — Configure AWS

Provide the required Amazon Bedrock credentials through `.env`, or use the application's sidebar if credentials are supported there.

### Step 3 — Start a Conversation

Enter a message in the chat interface and interact with Gemma 3.

### Step 4 — Upload Files

Upload supported documents when you want the chatbot to use their contents as additional context.

### Step 5 — Upload Images

Upload an image when you want to use the application's multimodal prompt functionality.

### Step 6 — Search Conversations

Use the conversation search functionality to find information from previously saved chats.

### Step 7 — Enable Web Context

Enable optional live web search when additional external context is required.

---

## Project Structure

A typical structure for the project is:

```text
Gemma-3-Chatbot/
│
├── app.py
├── requirements.txt
├── README.md
├── .env.example
├── .gitignore
│
└── data/
    └── conversations.json
```

The exact structure may vary depending on the current implementation.

---

## Conversation Storage

Conversation history is stored locally in:

```text
data/conversations.json
```

This allows conversations to persist locally between application sessions. :contentReference[oaicite:7]{index=7}

Before deploying the application publicly, review how conversation data is stored and protected.

---

## Security

### 🔐 Never Commit AWS Credentials

AWS credentials and other secrets should **never** be committed to GitHub.

Your `.gitignore` should include:

```gitignore
.env
.venv/
__pycache__/
*.pyc
```

### Example

Keep this locally:

```text
.env
```

But do **not** push it to GitHub.

Your repository should contain:

```text
.env.example
```

with placeholder values instead of real credentials.

### If Credentials Are Exposed

If real AWS credentials are accidentally committed:

1. Immediately revoke or rotate the exposed credentials.
2. Create replacement credentials.
3. Update your local `.env`.
4. Remove the secret from Git history if necessary.
5. Verify the secret is no longer present.
6. Push the cleaned repository.

**Never rely on `.gitignore` alone if a secret has already been committed to Git history.**

---

## Privacy Considerations

This application stores conversation history locally in:

```text
data/conversations.json
```

Uploaded documents may also be processed locally by the application.

Before using the application with confidential or sensitive information, review the application's storage and processing behavior.

For production deployment, consider implementing:

- User authentication
- Access control
- Encryption
- Secure secret management
- Data retention policies
- Audit logging
- Secure file handling

---

## Limitations

- AI-generated responses may contain errors.
- Web search results depend on external availability and quality.
- Document answers depend on the content and structure of uploaded files.
- Conversation storage is local.
- Amazon Bedrock access requires appropriate AWS configuration.
- Model availability depends on the configured AWS region and account access.
- AWS API usage may incur costs.
- Large documents or images may require additional processing resources.

---

## Responsible AI

The chatbot is an AI-assisted information tool and should not be treated as an authoritative source.

Users should independently verify important information, particularly when using AI-generated content for:

- Medical decisions
- Legal matters
- Financial decisions
- Security-sensitive tasks
- Other high-impact decisions

---

## Future Improvements

Potential future enhancements include:

- 🔐 User authentication
- 👥 Multi-user support
- 💾 Improved conversation database
- 📚 Multi-document conversations
- 🔍 Advanced semantic document search
- 🧠 Long-term memory
- 📑 Improved document citations
- 🌐 More advanced web research
- 🎙️ Voice input and output
- 📤 Conversation export
- 📊 Usage analytics
- 🛡️ Advanced AI safety controls
- ☁️ Production cloud deployment
- 🔒 Enterprise-grade security

---

## Learning Objectives

This project demonstrates practical implementation of:

- Streamlit application development
- Amazon Bedrock integration
- Google Gemma model integration
- LangChain/LLM application concepts
- Streaming AI responses
- Conversational AI
- Session and persistent conversation management
- Document processing
- Multimodal AI interactions
- Web search integration
- Environment-based secret management

---

## Use Cases

The architecture can be adapted for:

- 💬 General-purpose AI assistants
- 📚 Learning assistants
- 📄 Document analysis
- 🔎 Research assistance
- 🧑‍💻 Developer assistants
- 📝 Writing assistants
- 🖼️ Image-aware AI assistants
- 🏢 Internal knowledge assistants
- 🤖 Custom conversational AI applications

---

## Project Highlights

### AI & Machine Learning

- Google Gemma 3 model
- Amazon Bedrock integration
- Streaming model inference
- Multimodal prompt support

### Document Intelligence

- Multiple document format support
- Local document chunking
- Retrieval-style document context

### Conversational AI

- Persistent conversations
- Past conversation search
- Real-time streaming responses

### Web Intelligence

- Optional live web context
- Lightweight DuckDuckGo search integration

### User Experience

- Interactive Streamlit interface
- File and image upload
- Configurable AI interaction

---

## Security Checklist

Before pushing this project to GitHub:

```text
[ ] .env is included in .gitignore
[ ] Real AWS credentials are not in the repository
[ ] .env.example contains only placeholder values
[ ] No API keys are present in source files
[ ] No AWS secret keys are present in README files
[ ] Local conversation data is reviewed before committing
[ ] __pycache__ files are ignored
```

---

## License

This project is available under the license included in this repository.

---

## Author

**Darshan S**

GitHub:

```text
https://github.com/DarshanS2004
```

---

## Conclusion

**Gemma 3 Chatbot** demonstrates how Google's Gemma 3 model can be integrated with Amazon Bedrock and Streamlit to build a modern conversational AI application.

With streaming responses, persistent conversations, past-chat search, document understanding, multimodal image support, and optional web context, the project provides a strong foundation for developing more advanced AI assistants.