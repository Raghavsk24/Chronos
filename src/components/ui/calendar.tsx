"use client"

import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col gap-2',
        month: 'flex flex-col gap-4',
        month_caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center gap-1',
        button_previous: cn(
          'absolute left-1 h-7 w-7 inline-flex items-center justify-center',
          'rounded-md border border-input bg-transparent p-0',
          'opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors'
        ),
        button_next: cn(
          'absolute right-1 h-7 w-7 inline-flex items-center justify-center',
          'rounded-md border border-input bg-transparent p-0',
          'opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors'
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground w-9 font-normal text-[0.8rem] text-center py-1',
        weeks: 'flex flex-col gap-1 mt-1',
        week: 'flex',
        day: 'relative p-0 text-center',
        day_button: cn(
          'h-9 w-9 p-0 font-normal text-sm inline-flex items-center justify-center rounded-md',
          'hover:bg-accent hover:text-accent-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        ),
        selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground rounded-md',
        today: 'bg-accent text-accent-foreground rounded-md',
        outside: 'text-muted-foreground opacity-50',
        disabled: 'text-muted-foreground opacity-50 pointer-events-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: (props) => {
          const { orientation, ...rest } = props as { orientation?: string } & React.SVGAttributes<SVGSVGElement>
          return orientation === 'left'
            ? <ChevronLeft className="h-4 w-4" {...rest} />
            : <ChevronRight className="h-4 w-4" {...rest} />
        },
      }}
      {...props}
    />
  )
}

Calendar.displayName = 'Calendar'

export { Calendar }
