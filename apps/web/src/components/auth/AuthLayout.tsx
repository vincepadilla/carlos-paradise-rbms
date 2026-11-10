import type { ReactNode } from "react";
import { Link } from "react-router";

function AuthLogo() {
    return (
        <Link
            to="/"
            aria-label="Carlos Paradise home"
            className="inline-flex items-center gap-2.5 text-white"
        >
            <img
                src="/assets/carlos-paradise-logo.jpg"
                alt=""
                className="size-[40px] rounded-full border-2 border-white object-cover"
            />
            <span className="flex flex-col leading-none">
                <span className="font-display text-[18px]">Carlos</span>
                <strong className="mt-1 text-[11px] uppercase tracking-[.15em]">
                    Paradise
                </strong>
            </span>
        </Link>
    );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <main className="grid min-h-screen grid-cols-[1.05fr_.95fr] overflow-x-hidden bg-paper font-sans text-sm text-ink max-[819px]:block">
            <section
                aria-label="Carlos Paradise villa"
                className="relative m-5 min-h-[650px] overflow-hidden max-[819px]:m-0 max-[819px]:h-[250px] max-[819px]:min-h-0"
            >
                <img
                    src="/assets/villa-exterior.jpg"
                    alt="Carlos Paradise villa, balcony, and swimming pool"
                    className="absolute inset-0 size-full object-cover object-[center_58%] max-[819px]:object-center"
                    fetchPriority="high"
                />
                <div className="relative flex h-full min-h-[calc(100vh-40px)] flex-col justify-between p-10 text-white max-[819px]:min-h-0 max-[819px]:p-5">
                    <AuthLogo />
                    <blockquote className="w-full max-w-[650px] bg-[#33291f] p-7 font-display text-[clamp(2.5rem,3.2vw,3rem)] font-bold leading-[1.12] tracking-[-.02em] text-white max-[1100px]:max-w-[520px] max-[1100px]:text-[34px] max-[819px]:max-w-[390px] max-[819px]:p-4 max-[819px]:text-[22px] max-[819px]:leading-[1.1]">
                        <p className="m-0">
                            “Ain&apos;t your ordinary villa!
                            <br />
                            No stress, just memories that will
                            <br />
                            fill ya!”
                        </p>
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
                    {children}
                </div>
            </section>
        </main>
    );
}
