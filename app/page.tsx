/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';

// We replaced S3 uploads with a local temporary upload API.
import { PhotoIcon, XCircleIcon } from '@heroicons/react/20/solid';
import { FileUploader } from 'react-drag-drop-files';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CodeViewer from '@/components/code-viewer';
import { AnimatePresence, motion } from 'framer-motion';
import ShimmerButton from '@/components/ui/shimmerbutton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import LoadingDots from '@/components/loading-dots';
import { readStream } from '@/lib/utils';

export default function UploadComponent() {
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
    // Keep a hidden description in state (received from the server via upload)
    // so we can forward it to the generate endpoint. This is never shown to the UI.
    const [imageDescription, setImageDescription] = useState<string | undefined>(undefined);
  let [status, setStatus] = useState<
    'initial' | 'uploading' | 'uploaded' | 'creating' | 'created'
  >('initial');
  let [model, setModel] = useState(
    'gemini-2.5-flash'
  );
  const [generatedCode, setGeneratedCode] = useState('');
  const [shadcn, setShadcn] = useState(false);
  // imageDescription removed per request (we no longer display Gemini text)
  const [buildingMessage, setBuildingMessage] = useState(
    'Building your app...'
  );

  let loading = status === 'creating';

  useEffect(() => {
    let el = document.querySelector('.cm-scroller');
    if (el && loading) {
      let end = el.scrollHeight - el.clientHeight;
      el.scrollTo({ top: end });
    }
  }, [loading, generatedCode]);

  const handleFileChange = async (file: File) => {
    setStatus('uploading');
    // Resize large raster images client-side to reduce upload size and
    // model preprocessing time. We skip resizing for SVGs (vector).
    let uploadFile: File = file;
    try {
      const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');
      if (!isSvg && (file.type.startsWith('image/'))) {
        const resized = await resizeImageFile(file, 1280, 0.8);
        if (resized) uploadFile = resized;
      }
    } catch (e) {
      // If resizing fails for any reason, fall back to the original file.
      console.warn('Image resize failed, uploading original file:', e);
    }

    // POST the file to our temporary upload endpoint which returns a data URL
    const form = new FormData();
    form.append('file', uploadFile);

    const res = await fetch('/api/s3-upload', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      setStatus('initial');
      throw new Error('Upload failed');
    }

    const data = await res.json();
    setImageUrl(data.url);
  // store the hidden description for use in generation
  setImageDescription(data.description as string | undefined);
    setStatus('uploaded');

    // Auto-start the generation flow once upload completes. Pass explicit
    // values to avoid a state update race where the request might be sent
    // before state variables update.
    setTimeout(() => {
      createApp(data.url, data.description).catch((e) => console.error('generate failed', e));
    }, 50);
  };

  // Resize an image File using an offscreen canvas. Returns a new File (JPEG)
  // or null if conversion isn't possible. Keeps aspect ratio, constrains the
  // longest side to maxDim, and applies quality for JPEG compression.
  async function resizeImageFile(file: File, maxDim = 1280, quality = 0.8): Promise<File | null> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          if (width <= maxDim && height <= maxDim) {
            URL.revokeObjectURL(url);
            resolve(null); // no need to resize
            return;
          }

          const ratio = width / height;
          let newW = width;
          let newH = height;
          if (width > height) {
            newW = Math.min(width, maxDim);
            newH = Math.round(newW / ratio);
          } else {
            newH = Math.min(height, maxDim);
            newW = Math.round(newH * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = newW;
          canvas.height = newH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, newW, newH);

          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);
              if (!blob) return resolve(null);
              const ext = 'jpg';
              const newFile = new File([blob], file.name.replace(/\.(png|jpe?g|webp|bmp)$/i, `.${ext}`), { type: 'image/jpeg' });
              resolve(newFile);
            },
            'image/jpeg',
            quality
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  async function createApp(overrideImageUrl?: string | undefined, overrideImageDescription?: string | undefined) {
    setStatus('creating');
    setGeneratedCode('');
    setBuildingMessage('Building your app...');

    const bodyPayload: any = {
      model,
      shadcn,
      imageUrl: overrideImageUrl ?? imageUrl,
      imageDescription: overrideImageDescription ?? imageDescription,
    };

    let res = await fetch('/api/generateCode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) throw new Error(res.statusText);
    if (!res.body) throw new Error('No response body');

    for await (let chunk of readStream(res.body)) {
      setGeneratedCode((prev) => prev + chunk);
    }

    setStatus('created');
  }

  function handleSampleImage() {
    const samplePath = '/booking.png';
    setImageUrl(samplePath);
    setStatus('uploaded');
    // Auto-start generation for the sample image too (pass URL explicitly).
    setTimeout(() => {
      createApp(samplePath, undefined).catch((e) => console.error('generate failed', e));
    }, 50);
  }

  return (
    <div className='flex justify-center mt-5 mx-10 gap-5 sm:flex-row flex-col grow'>
      {status === 'initial' ||
      status === 'uploading' ||
      status === 'uploaded' ? (
        <div className='flex-1 w-full flex-col flex justify-center items-center text-center mx-auto'>
          <div className='max-w-xl text-center'>
            <picture>
              <source srcSet='/hero.png' type='image/png' />
              <img src='/hero-3.svg' alt='Hero' className='mx-auto mb-6' />
            </picture>
            <h1 className='text-4xl font-bold text-balance tracking-tight'>
              Pixareact — Mockup to app
            </h1>
            <div className='max-w-md text-center mx-auto'>
              <p className='text-lg text-gray-500 mt-4 text-center'>
                Upload your website design — we'll build a polished, working React + Tailwind app you can run and refine.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className='relative flex-1 w-full h-[80vh] overflow-x-hidden'>
          <div className='isolate h-full'>
            <CodeViewer code={generatedCode} showEditor />
          </div>

          <AnimatePresence>
            {status === 'creating' && (
              <motion.div
                initial={{ x: '80%' }}
                animate={{ x: '0%' }}
                exit={{ x: '80%' }}
                transition={{
                  type: 'spring',
                  bounce: 0,
                  duration: 0.85,
                  delay: 0.1,
                }}
                className='absolute inset-x-0 bottom-0 top-1/2 flex items-center justify-center rounded-r border border-gray-400 bg-gradient-to-br from-gray-100 to-gray-300 md:inset-y-0 md:left-1/2 md:right-0'
              >
                <p className='animate-pulse text-xl font-bold'>
                  {status === 'creating' && buildingMessage}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      <div className='w-full max-w-xs gap-4 flex flex-col mx-auto'>
        {imageUrl ? (
          <div className='relative mt-2'>
            <div className='rounded-xl'>
              <img
                alt='Screenshot'
                src={imageUrl}
                className='w-full group object-cover relative'
              />
            </div>
            <button className='absolute size-10 text-gray-900 bg-white hover:text-gray-500 rounded-full -top-3 z-10 -right-3'>
              <XCircleIcon onClick={() => setImageUrl('')} />
            </button>
            {/* imageDescription removed per user request */}
          </div>
        ) : (
          <>
            <FileUploader
              handleChange={handleFileChange}
              name='file'
              label='Upload or drop your website design'
              types={['png', 'jpg', 'jpeg']}
              required={true}
              multiple={false}
              hoverTitle='Drop here'
            >
              <div className='mt-2 flex justify-center rounded-lg border border-dashed border-gray-900/25 px-6 py-10 cursor-pointer'>
                <div className='text-center'>
                  <PhotoIcon
                    className='mx-auto h-12 w-12 text-gray-300'
                    aria-hidden='true'
                  />
                  <div className='mt-4 flex text-sm leading-6 text-gray-600'>
                    <label
                      htmlFor='file-upload'
                      className='relative rounded-md bg-white font-semibold text-black focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-600 focus-within:ring-offset-2 hover:text-gray-700'
                    >
                      <div>Upload your website design</div>
                      <p className='font-normal text-gray-600 text-xs mt-1'>
                        or drag and drop
                      </p>
                    </label>
                  </div>
                </div>
              </div>
            </FileUploader>
            <div className='text-center'>
              <button
                className='font-medium text-blue-400 text-sm underline decoration-transparent hover:decoration-blue-200 decoration-2 underline-offset-4 transition hover:text-blue-500'
                onClick={handleSampleImage}
              >
                Need an example image? Try ours.
              </button>
            </div>
          </>
        )}

        <div className='flex items-center gap-2'>
          <label className='whitespace-nowrap'>AI Model:</label>
          <Select value={model} onValueChange={setModel} defaultValue={model}>
            <SelectTrigger className=''>
              <img src='/gemini.svg' alt='Gemini' className='size-5' />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value='gemini-2.5-flash'
                className='flex items-center justify-center gap-3'
              >
                Gemini 2.5 Flash
              </SelectItem>
              <SelectItem
                value='gemini-2.5-flash-lite'
                className='flex items-center justify-center gap-3'
              >
                Gemini 2.5 Flash-Lite
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <ShimmerButton
                  className='shadow-2xl disabled:cursor-not-allowed w-full relative disabled:opacity-50'
                  onClick={() => createApp()}
                  disabled={
                    status === 'initial' ||
                    status === 'uploading' ||
                    status === 'creating'
                  }
                >
                  <span
                    className={`${
                      loading ? 'opacity-0' : 'opacity-100'
                    } whitespace-pre-wrap text-center font-semibold leading-none tracking-tight text-white dark:from-white dark:to-slate-900/10 `}
                  >
                    Generate app
                  </span>

                  {loading && (
                    <span className='absolute inset-0 flex items-center justify-center pointer-events-none'>
                      <LoadingDots color='#fff' style='medium' />
                    </span>
                  )}
                </ShimmerButton>
              </div>
            </TooltipTrigger>

            {status === 'initial' && (
              <TooltipContent>
                <p>Please upload an image first</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
