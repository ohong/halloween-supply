import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Adapted from shadcn/ui's MIT-licensed Button, using this store's monochrome tokens.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[4px] text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#111] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[#111] text-white hover:bg-[#333]",
        outline: "border border-[#CCC] bg-white text-[#333] hover:bg-[#EFEEEF]",
        ghost: "text-[#666] hover:bg-[#EFEEEF] hover:text-[#111]",
      },
      size: { default: "min-h-11 px-4", sm: "min-h-9 px-3 text-xs", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, asChild = false, type = "button", ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={cn(buttonVariants({ variant, size, className }))} type={type} {...props} />;
}
