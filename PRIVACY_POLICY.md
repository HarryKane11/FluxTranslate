% Privacy Policy

Last updated: 2024-09-29

FluxTranslate (the “Extension”) is a browser extension that performs inline page translation using third‑party Large Language Model (LLM) APIs. This policy explains what data the Extension handles and how it is used.

## Summary
- No developer‑run servers: the Extension sends translation requests directly from your browser to the LLM provider you select (OpenAI, Anthropic, Google Gemini, Groq).
- No personal data collection by the developers.
- Your API keys and settings are stored only in your browser’s local storage.
- All network requests to model providers use HTTPS.

## Data We Process
- Translation content: Text you choose to translate is sent from your browser to the selected LLM provider’s API to obtain translations. The text is not sent to any developer‑controlled servers.
- Local settings: Target language, tone, provider/model selection, and your API keys are stored in `chrome.storage.local` on your device. This data does not leave your browser except when you export or sync it yourself.

## Third‑Party Services
- The Extension communicates with third‑party LLM providers. Your use of those APIs is subject to each provider’s own terms and privacy policies:
  - OpenAI API: https://api.openai.com/
  - Anthropic API: https://api.anthropic.com/
  - Google Generative Language API (Gemini): https://generativelanguage.googleapis.com/
  - Groq API: https://api.groq.com/

## Security
- All calls to the providers are made over HTTPS.
- API keys are stored locally in your browser via `chrome.storage.local` and are not transmitted to any developer‑controlled server.

## Contact
If you have questions or requests related to this policy, please open an issue on the project’s GitHub repository.

---

## 한국어 요약
- 확장은 개발자 서버를 사용하지 않고, 사용자가 선택한 LLM 제공사의 API로 브라우저에서 직접 번역 요청을 전송합니다.
- 개발자는 개인 식별 정보를 수집하지 않습니다.
- API 키와 설정은 브라우저의 `chrome.storage.local`에만 저장됩니다.
- 모든 통신은 HTTPS를 사용합니다.

문의: GitHub 이슈로 연락해 주세요.

