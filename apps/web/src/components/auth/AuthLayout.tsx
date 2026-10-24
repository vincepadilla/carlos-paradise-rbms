import type { ReactNode } from "react";
import { Link } from "react-router";

function AuthLogo({ light = false }: { light?: boolean }) {
    return (
        <Link
            to="/"
            aria-label="Carlos Paradise home"
            className={`inline-flex items-center gap-2.5 ${light ? "text-white" : "text-brown"}`}
        >
            <img
                src="/assets/carlos-paradise-logo.jpg"
                alt=""
                className="size-[38px] rounded-full border-2 border-current object-cover"
            />
            <span className="flex flex-col leading-none">
                <span className="font-display text-[17px]">Carlos</span>
                <strong className="mt-1 text-[11px] uppercase tracking-[.15em]">
                    Paradise
                </strong>
            </span>
        </Link>
    );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <main className="grid min-h-screen grid-cols-[1.05fr_.95fr] bg-paper font-sans text-sm text-ink max-[819px]:block">
            <section
                aria-label="Carlos Paradise villa"
                className="relative m-[18px] overflow-hidden max-[819px]:m-0 max-[819px]:h-[220px]"
            >
                <img
                    src="/assets/villa-exterior.jpg"
                    alt="Carlos Paradise private villa at dusk"
                    className="absolute inset-0 size-full object-cover"
                    fetchPriority="high"
                />
                <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(32,24,18,.7),transparent_65%)]" />
                <div className="relative z-10 flex h-full min-h-[650px] flex-col justify-between p-9 text-white max-[819px]:min-h-0 max-[819px]:p-[25px]">
                    <AuthLogo light />
                    <blockquote className="w-fit max-w-[90%] bg-[#33291f] px-[22px] py-[18px] font-display text-[clamp(1.7rem,3vw,2.7rem)] font-normal leading-[1.2] max-[819px]:max-w-full max-[819px]:px-[15px] max-[819px]:py-3 max-[819px]:text-[23px]">
                        “Ain&apos;t your ordinary villa!
                        <br />
                        No stress, just memories that will fill ya!”
                    </blockquote>
                </div>
            </section>
            <section className="flex flex-col justify-center px-[7vw] py-[25px] max-[819px]:px-5 max-[819px]:pb-[50px]">
                <Link
                    to="/"
                    className="mb-[25px] w-fit text-muted transition-colors hover:text-brown focus-visible:outline-2 focus-visible:outline-gold"
                >
                    ← Back to home
                </Link>
                <div className="mx-auto my-auto w-full max-w-[460px]">
                    <div className="mb-[50px] max-[819px]:hidden">
                        <AuthLogo />
                    </div>
                    {children}
                </div>
            </section>
        </main>
    );
}
