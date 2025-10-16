import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import Image from 'next/image';
import Link from 'next/link';
import Logo from '@/public/biglogo.png';
import { Button } from '@/components/ui/button';
import { GitHubLogoIcon, TwitterLogoIcon } from '@radix-ui/react-icons';
import PlausibleProvider from 'next-plausible';

let title = 'Pixareact – Screenshot to code';
let description = 'Generate your next app from a screenshot using AI';
let url = 'https://www.pixareact.com';
let ogimage = 'https://www.pixareact.com/og-image.png';
let sitename = 'pixareact';

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title,
  description,
  icons: {
    icon: '/favicon.png',
  },
  openGraph: {
    images: [ogimage],
    title,
    description,
    url: url,
    siteName: sitename,
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    images: [ogimage],
    title,
    description,
  },
};

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' className='h-full'>
      <head>
        <PlausibleProvider domain='pixareact.com' />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-full flex flex-col font-sans`}
      >
        <header className='sm:mx-10 mx-4 mt-5'>
          <div className='flex items-center justify-between'>
            <Link href='/'>
              <Image src={Logo} alt='Logo' width={400} height={50} />
            </Link>
            <Button
              asChild
              variant='outline'
              className='hidden sm:inline-flex gap-2'
            >
              <Link href='https://github.com/samolubukun/Pixareact' target='_blank'>
                <GitHubLogoIcon className='size-4' />
                GitHub
              </Link>
            </Button>
          </div>
        </header>

        <main className='grow flex flex-col'>{children}</main>

        <footer className='flex flex-col sm:flex-row items-center justify-between sm:px-10 px-4 pt-20 pb-6 gap-4 sm:gap-0 sm:py-3 text-gray-600 text-sm'>
          <p>
            Powered by{' '}
            <span className='font-bold'>Gemini</span>
            {' '}and{' '}
            <span className='font-bold'>Sandpack</span>
          </p>
          <div className='flex gap-4'>
            <Button asChild variant='ghost' className='gap-2'>
              <Link href='https://github.com/samolubukun/Pixareact' target='_blank'>
                <GitHubLogoIcon className='size-4' />
                GitHub
              </Link>
            </Button>
            <Button asChild variant='ghost' className='gap-2'>
              <Link href='https://x.com/samuelolubukun' target='_blank'>
                <TwitterLogoIcon className='size-4' />
                @samuelolubukun
              </Link>
            </Button>
            <Button asChild variant='ghost' className='gap-2'>
              <Link href='https://www.linkedin.com/in/samuel-olubukun-50a57a1a9/' target='_blank' className='flex items-center gap-2'>
                {/* Inline LinkedIn SVG icon */}
                <svg width='16' height='16' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden>
                  <path d='M4.98 3.5C4.98 4.88 3.88 6 2.5 6C1.12 6 0 4.88 0 3.5C0 2.12 1.12 1 2.5 1C3.88 1 4.98 2.12 4.98 3.5ZM0.5 8.5H4.5V24H0.5V8.5ZM8.5 8.5H12.1V10.2H12.2C12.9 9 14.7 7.8 17 7.8C22.4 7.8 24 10.9 24 15.6V24H20V16.5C20 14.2 19.6 11.6 16.2 11.6C13.8 11.6 13 13.3 12.7 14.3V24H8.5V8.5Z' fill='currentColor'/>
                </svg>
                LinkedIn
              </Link>
            </Button>
          </div>
        </footer>
      </body>
    </html>
  );
}
