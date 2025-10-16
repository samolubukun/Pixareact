import shadcnDocs from '@/lib/shadcn-docs';
import dedent from 'dedent';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { imageDescriptions } from '@/lib/image-store';

// Generate code/text for a screenshot. We accept { model, imageUrl, shadcn }
// from the client. imageUrl is expected to be a data URL (data:<mime>;base64,...)
// as returned by the app's temporary upload endpoint.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const model = body?.model as string | undefined;
    const imageUrl = body?.imageUrl as string | undefined;
  const imageId = body?.imageId as string | undefined;
    // Client may forward a hidden imageDescription received from upload.
    const clientImageDescription = body?.imageDescription as string | undefined;
    const shadcn = Boolean(body?.shadcn);

    const key = process.env.GEMINI_API_KEY || '';
    if (!key) return new Response('GEMINI_API_KEY not set', { status: 500 });

    // Build the prompt
    const system = getCodingPrompt(shadcn);
  // If the client provided an imageId, and we have a stored description for
  // it, prefer that. Otherwise prefer a client-provided description (hidden
  // field returned from upload). Fallback to image URL or 'none'.
  const stored = imageId ? imageDescriptions.get(imageId) : undefined;
  const imageDescriptor = stored?.description ?? clientImageDescription ?? (imageUrl ? `Image URL: ${imageUrl}` : 'none');

    // Prepare optional image payload. Support both data URLs (inlineData)
    // and remote HTTP(S) URLs (fileData). This allows sending the actual
    // image bytes/URI to Gemini so it can generate code even when no
    // textual description is available.
    let imagePayload: { inline?: { data: string; mimeType?: string }; file?: { fileUri: string; mimeType?: string } } | null = null;
    if (imageUrl) {
      if (imageUrl.startsWith('data:')) {
        const m = imageUrl.match(/^data:([^;]+);base64,(.*)$/);
        if (m) {
          imagePayload = { inline: { data: m[2], mimeType: m[1] } };
        }
      } else if (/^https?:\/\//i.test(imageUrl)) {
        // For remote URLs, provide a fileData part with the URI.
        // We don't always know the mimeType; leave it undefined if unknown.
        imagePayload = { file: { fileUri: imageUrl, mimeType: undefined } };
      }
    }

  const userPrompt = imagePayload 
    ? `Analyze the provided image and create a React TypeScript component that recreates the UI shown. Transform any sketches, wireframes, or mockups into a polished, professional web interface.`
    : `Create a React TypeScript component that recreates the UI described. Image description: ${imageDescriptor}`;
  const fullPrompt = `${system}\n\nUser: ${userPrompt}`;

    // Use SDK
    const ai = new GoogleGenAI({ apiKey: key });

    let response: any;
    const modelName = model ? (model.startsWith('models/') ? model : `models/${model}`) : 'models/gemini-2.5-flash';

    // Single-call multimodal: always send the system prompt, user prompt,
    // and image bytes/URI (if present) in a single generateContent call so
    // Gemini can use the visual information directly. This avoids the
    // extra round-trip of requesting a description first and halves
    // model-call latency for first-time images.
    const descriptionToUse = stored?.description ?? clientImageDescription;
    const systemPromptText = system;
    const userPromptText = `${userPrompt}${descriptionToUse ? `\n\nImage description: ${descriptionToUse}` : ''}`;

    if (imagePayload) {
      // Build the image part depending on whether it's inline bytes or a file URI
      const imagePart = imagePayload.inline
        ? { inlineData: { data: imagePayload.inline.data, mimeType: imagePayload.inline.mimeType } }
        : { fileData: { fileUri: imagePayload.file!.fileUri, mimeType: imagePayload.file!.mimeType } };

      const contents: any[] = [systemPromptText, userPromptText, imagePart];
      response = await ai.models.generateContent({ model: modelName, contents: contents as any });
    } else {
      // No image available: send system + user as text only.
      const contents = `${systemPromptText}\n\n${userPromptText}`;
      response = await ai.models.generateContent({ model: modelName, contents: contents });
    }

    const text = response?.text ?? response?.candidates?.[0]?.content ?? response?.output?.[0]?.content ?? JSON.stringify(response);

    // Sanitize common model output issues before streaming back to the client.
    let sanitized = sanitizeGeneratedCode(String(text));

    // If basic heuristics detect likely unbalanced syntax (unterminated
    // template literal, mismatched braces/parens), attempt one automatic
    // repair by asking the model to return a corrected TypeScript file.
    if (isLikelyBroken(sanitized)) {
      try {
        const repaired = await repairWithModel(ai, modelName, sanitized);
        if (repaired) {
          sanitized = sanitizeGeneratedCode(String(repaired));
        }
      } catch (e) {
        console.warn('Auto-repair attempt failed:', e);
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(String(sanitized)));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: new Headers({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/plain; charset=utf-8' }),
    });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}

/**
 * Apply small, safe fixes to model-generated code to reduce common syntax
 * errors that prevent the app from compiling. This is intentionally
 * conservative — we only perform non-destructive fixes.
 */
function sanitizeGeneratedCode(src: string) {
  let out = src;

  // 1) Remove a stray single or double quote immediately following a closing
  // curly brace in JSX attributes: `onClick={handle}''` -> `onClick={handle}`
  out = out.replace(/(\})(['"])\s*(?=[>\n\r])/g, '$1');

  // 2) Common model bug: trailing quote at end of attribute (e.g. onClick={...}')
  out = out.replace(/(on\w+=\{[^}]*\})['"]/g, (_m, p1) => p1);

  // 3) Remove accidental lone backticks at line ends
  out = out.replace(/`\s*$/gm, '');

  // 3.1) Remove lines that contain only a single or double quote (common
  // model artifact when a string was started but left alone on a line).
  out = out.replace(/^\s*['"]\s*$/gm, '');

  // 3.2) Fix cases where a line ends with a lone opening quote and the
  // next non-empty line is a closing brace or end of expression. Example:
  //   isFocused ? 'shadow-inner' : '
  // }
  // Convert the trailing lone quote into an empty string literal to
  // avoid unterminated string constants:  : ''
  out = out.replace(/(:\s*)['"]\s*(\r?\n\s*[}\)\];,`])/g, "$1''$2");


  // 3.3) Conservative fix for unterminated string constants that appear as
  // a lone opening quote at the end of a line where the very next non-empty
  // line is a closing token (}, ), ], ;, , or `). This commonly happens in
  // ternary expressions produced by the model like:
  //   isFocused ? 'shadow-inner' : '
  // }
  // In those cases convert the trailing opening quote into an empty string
  // literal ('' or "") to avoid unterminated string errors.
  try {
    const lines = out.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // look for a line that ends with a quote (single or double) possibly
      // preceded by whitespace
      const m = line.match(/([\s:=,\(\[]*)(['"])\s*$/);
      if (m) {
        // find next non-empty line
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        const next = j < lines.length ? lines[j].trim() : '';
        if (next.startsWith('}') || next.startsWith(')') || next.startsWith(']') || next.startsWith(',') || next.startsWith(';') || next.startsWith('`')) {
          // replace the trailing opening quote with an empty string literal
          lines[i] = line.replace(/(['"])\s*$/, "''");
        }
      }
    }
    out = lines.join('\n');
  } catch (e) {
    // If anything goes wrong, fall back to the original string without
    // attempting this specific conservative transform.
  }

  // 4) Don't collapse two single quotes into one globally. That can turn a
  // valid empty string literal into a single-quote character and break
  // code. Keep '' as-is.

  // 5) Trim stray control characters that might break parsing
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, '');

  return out;
}

function isLikelyBroken(src: string) {
  // Detect unterminated template literals (odd number of unescaped backticks)
  const backticks = (src.match(/(?<!\\)`/g) || []).length;
  if (backticks % 2 === 1) return true;

  // Detect odd number of unescaped single or double quotes across the file.
  // This is conservative: if either single or double quotes are unbalanced
  // there's likely a syntax error. We ignore quotes that appear inside
  // backtick template literals by removing backtick contents first.
  const withoutTemplates = src.replace(/`[\s\S]*?`/g, '');
  const singleQuotes = (withoutTemplates.match(/(?<!\\)'/g) || []).length;
  const doubleQuotes = (withoutTemplates.match(/(?<!\\)"/g) || []).length;
  if (singleQuotes % 2 === 1) return true;
  if (doubleQuotes % 2 === 1) return true;

  // Look for lines that clearly end in an opening quote and the next
  // non-empty line starts with a closing token. This indicates a stray
  // opening quote left on its own line.
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/['"]\s*$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const next = j < lines.length ? lines[j].trim() : '';
      if (next.startsWith('}') || next.startsWith(')') || next.startsWith(']') || next.startsWith(',') || next.startsWith(';')) {
        return true;
      }
    }
  }

  // Basic bracket balance checks
  const counts = {
    '{': (src.match(/{/g) || []).length,
    '}': (src.match(/}/g) || []).length,
    '(': (src.match(/\(/g) || []).length,
    ')': (src.match(/\)/g) || []).length,
    '[': (src.match(/\[/g) || []).length,
    ']': (src.match(/\]/g) || []).length,
  };
  if (counts['{'] !== counts['}']) return true;
  if (counts['('] !== counts[')']) return true;
  if (counts['['] !== counts[']']) return true;

  return false;
}

async function repairWithModel(ai: any, modelName: string, brokenCode: string) {
  // Instruct the model to repair the TypeScript React file and return only
  // the corrected file contents. Keep the instruction short and explicit.
  const repairPrompt = `The following file is a TypeScript React component which may
have syntax errors (unterminated template literals, unmatched braces, stray
quotes, etc.). Fix the file so it is valid TypeScript/TSX and return only the
complete corrected file contents with no explanation or surrounding code fences.`;

  const contents = [repairPrompt, brokenCode];
  const resp = await ai.models.generateContent({ model: modelName, contents: contents as any });
  const repaired = resp?.text ?? resp?.candidates?.[0]?.content ?? resp?.output?.[0]?.content ?? null;
  return repaired ? String(repaired) : null;
}

function getCodingPrompt(shadcn: boolean) {
  let systemPrompt = `
You are an expert frontend React developer. You will be given an image (screenshot, sketch, wireframe, or mockup) and you will return FULLY FUNCTIONAL, INTERACTIVE React code using React and Tailwind CSS. Follow the instructions carefully, it is very important for my job. I will tip you $1 million if you do a good job:

- CRITICAL: You MUST create a COMPLETE, INTERACTIVE, PRODUCTION-READY React application - NOT a sketch, NOT a mockup, NOT a static image. The output should be a fully functional web interface that users can interact with.
- CORE PURPOSE: This tool converts sketches, wireframes, hand-drawn designs, and rough mockups into polished, professional-looking React applications. Transform any sketch or rough design into a REAL, WORKING web interface.
- OUTPUT REQUIREMENT: Your result must be an ACTUAL FRONTEND IMPLEMENTATION - buttons should be clickable, forms should be functional, navigation should work, interactive elements should have proper state management.
- Analyze the provided image carefully and think step by step about how to recreate the UI shown as a FULLY FUNCTIONAL React component.
- Create a React component that recreates exactly what you see in the image and make sure it can run by itself by using a default export
- Make it INTERACTIVE: Add onClick handlers, form submissions, state management, hover effects, and any other interactions that would be expected in a real application.
- Feel free to have multiple components in the file, but make sure to have one main component that uses all the other components
- Make sure the website looks exactly like what's shown in the image AND functions like a real web application.
- Pay close attention to background color, text color, font size, font family, padding, margin, border, etc. Match the colors and sizes as closely as possible to what you see.
- Make sure to code every part of what you see including any headers, footers, navigation, content areas, etc. - ALL MUST BE FUNCTIONAL.
- Use any text you can read from the image for the UI elements. If text is unclear, use appropriate placeholder text.
- Do not add comments in the code such as "<!-- Add other navigation links as needed -->" and "<!-- ... other news items ... -->" in place of writing the full code. WRITE THE FULL CODE.
- Repeat elements as needed to match what you see. For example, if there are 15 items visible, the code should have 15 items. DO NOT LEAVE comments like "<!-- Repeat for each news item -->" or bad things will happen.
- For all images, please use an svg with a white, gray, or black background and don't try to import them locally or from the internet.
- MANDATORY: Make sure the React app is interactive and functional by creating state when needed, event handlers, form logic, and having no required props. This should be a COMPLETE working application.
- Add realistic functionality: if there's a search bar, make it actually filter results; if there are tabs, make them switch content; if there are buttons, make them do something meaningful.
- If you use any imports from React like useState, useEffect, useCallback, etc., make sure to import them directly
- Use TypeScript as the language for the React component
- Use Tailwind classes for styling. DO NOT USE ARBITRARY VALUES (e.g. \`h-[600px]\`). Make sure to use a consistent color palette.
- Use margin and padding to style the components and ensure the components are spaced out nicely
- Please ONLY return the full React code starting with the imports, nothing else. It's very important for my job that you only return the React code with imports. DO NOT START WITH \`\`\`typescript or \`\`\`javascript or \`\`\`tsx or \`\`\`.
- ONLY IF the user asks for a dashboard, graph or chart, the recharts library is available to be imported, e.g. \`import { LineChart, XAxis, ... } from "recharts"\` & \`<LineChart ...><XAxis dataKey="name"> ...\`. Please only use this when needed.
- If you need an icon, import it from a library or please create an SVG for it if the icon isn't available in the libraries and use it in the code.
- Make the design look nice and don't have borders around the entire website even if that's described
- FINAL REMINDER: The output must be a WORKING, INTERACTIVE React application - not a static representation or another sketch.
  `;

  if (shadcn) {
    systemPrompt += `
    There are some prestyled components available for use. Please use your best judgement to use any of these components if the app calls for one.

    Here are the components that are available, along with how to import them, and how to use them:

    ${shadcnDocs
      .map(
        (component) => `
          <component>
          <name>
          ${component.name}
          </name>
          <import-instructions>
          ${component.importDocs}
          </import-instructions>
          <usage-instructions>
          ${component.usageDocs}
          </usage-instructions>
          </component>
        `
      )
      .join('\n')}
    `;
  }

  systemPrompt += `
    NO OTHER LIBRARIES (e.g. zod, hookform) ARE INSTALLED OR ABLE TO BE IMPORTED.
  `;

  systemPrompt += `
  Here are some examples of good outputs:


${examples
  .map(
    (example) => `
      <example>
      <input>
      ${example.input}
      </input>
      <output>
      ${example.output}
      </output>
      </example>
  `
  )
  .join('\n')}
  `;

  return dedent(systemPrompt);
}

export const runtime = 'edge';

let examples = [
  {
    input: `A landing page screenshot`,
    output: `
import { Button } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-black mr-2"></div>
            <span className="font-bold text-xl">LOGO</span>
          </div>
          <nav className="hidden md:flex space-x-8">
            <a href="#features" className="text-gray-700 hover:text-gray-900">Features</a>
            <a href="#about" className="text-gray-700 hover:text-gray-900">About</a>
            <a href="#pricing" className="text-gray-700 hover:text-gray-900">Pricing</a>
          </nav>
          <Button variant="outline" className="rounded-full">Sign up</Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-block px-4 py-2 rounded-full bg-gray-200 text-sm text-gray-700 mb-6">
              Used by 100+ companies
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              Welcome to your all-in-one AI tool
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Check out all the new features in the 13.2 update in the demo below
            </p>
            <Button className="rounded-full px-8 py-3 bg-black text-white hover:bg-gray-800">
              Get Started
            </Button>
          </div>
          <div className="bg-gray-300 aspect-video rounded-lg flex items-center justify-center">
            <span className="text-gray-600 text-2xl">IMAGE PLACEHOLDER</span>
          </div>
        </div>
      </main>
    </div>
  )
}
    `,
  },
];
