---
name: UI Design Conventions
description: Styling patterns, component conventions, and design tokens used
  across the app. Use when building new UI components to maintain visual
  consistency.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T18:10:09.703Z
---

# UI Design Conventions

## Design System
- **Framework**: React + Tailwind CSS
- **Component Library**: Custom `client/components/ui/` based on shadcn/ui patterns
- **Icons**: `lucide-react/dynamic` via `<Icon icon="name" />` component
- **Toasts**: Sonner (`import { toast } from "sonner"`)

## Color Palette
- **Primary/Brand**: `#6A3DB8` (purple)
- **Background**: `#F7F7F7` (light gray)
- **Active nav**: `bg-white/15` with white left border
- **Hover nav**: `bg-white/[0.08]`
- **Text on purple**: `text-white`, `text-white/80`, `text-white/60`

## Patterns
- Use `useApiData` for data loading, `useApi` for mutations
- Show loading skeletons on first load
- Show subtle opacity (`opacity-70`) on refetch while keeping content interactive
- Use `useCountUp` hook for animated KPI numbers
- Cards use the `<Card>` component from `client/components/ui/card.tsx`

## Navigation
- Use `useNavigate()` from react-router for programmatic navigation
- Use `useLocation()` to determine active state
