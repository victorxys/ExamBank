"use client"

import * as React from "react"
import {
    ChevronDownIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
} from "lucide-react"
import { DayButton, DayPicker } from "react-day-picker"

import { cn } from "../../utils"
import { Button, buttonVariants } from "./button"

function Calendar({
    className,
    classNames,
    showOutsideDays = true,
    captionLayout = "label",
    buttonVariant = "ghost",
    formatters,
    components,
    ...props
}) {
    return (
        <DayPicker
            showOutsideDays={showOutsideDays}
            className={cn("bg-background p-3", className)}
            captionLayout={captionLayout}
            formatters={{
                formatMonthDropdown: (date) =>
                    date.toLocaleString("zh-CN", { month: "short" }),
                formatYearDropdown: (date) => `${date.getFullYear()}`,
                ...formatters,
            }}
            classNames={{
                months: "relative flex flex-col gap-4 md:flex-row",
                month: "flex w-full flex-col gap-4",
                nav: "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
                button_previous: cn(
                    buttonVariants({ variant: buttonVariant }),
                    "h-8 w-8 p-0"
                ),
                button_next: cn(
                    buttonVariants({ variant: buttonVariant }),
                    "h-8 w-8 p-0"
                ),
                month_caption: "flex h-8 w-full items-center justify-center px-8",
                dropdowns: "flex w-full items-center justify-center gap-2 text-sm font-medium",
                dropdown_root: "relative rounded-md border border-input",
                dropdown: "absolute inset-0 opacity-0 cursor-pointer",
                caption_label: cn(
                    "select-none font-medium text-sm",
                    captionLayout !== "label" && "flex items-center gap-1 rounded-md px-2 py-1"
                ),
                table: "w-full border-collapse",
                weekdays: "flex",
                weekday: "text-muted-foreground w-9 h-9 flex items-center justify-center text-xs font-normal",
                week: "flex w-full mt-2",
                day: "relative w-9 h-9 p-0 text-center text-sm",
                day_button: cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-9 w-9 p-0 font-normal rounded-md"
                ),
                range_start: "bg-accent rounded-l-md",
                range_middle: "rounded-none",
                range_end: "bg-accent rounded-r-md",
                today: "bg-accent text-accent-foreground rounded-md",
                outside: "",
                disabled: "text-gray-300 line-through cursor-not-allowed",
                hidden: "invisible",
                selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                ...classNames,
            }}
            components={{
                Chevron: ({ className, orientation, ...props }) => {
                    if (orientation === "left") {
                        return <ChevronLeftIcon className={cn("size-4", className)} {...props} />
                    }
                    if (orientation === "right") {
                        return <ChevronRightIcon className={cn("size-4", className)} {...props} />
                    }
                    return <ChevronDownIcon className={cn("size-4", className)} {...props} />
                },
                ...components,
            }}
            {...props}
        />
    )
}

Calendar.displayName = "Calendar"

export { Calendar }
