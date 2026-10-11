import { createElement } from "react";
import {
  BadgePercent,
  Baby,
  Bike,
  Car,
  Drill,
  Factory,
  Gamepad2,
  Gift,
  HeartPulse,
  Monitor,
  Package,
  Shirt,
  Smartphone,
  Sofa,
  Sparkles,
  Sprout,
  WashingMachine,
  Wrench,
  type LucideIcon,
} from "lucide-react";

// Icons for the supplier's root categories, matched by name.
const RULES: [RegExp, LucideIcon][] = [
  [/компьютер/i, Monitor],
  [/бытов/i, WashingMachine],
  [/электрон/i, Smartphone],
  [/авто|мото/i, Car],
  [/строител|ремонт/i, Drill],
  [/для дома|мебел/i, Sofa],
  [/одежд|обув/i, Shirt],
  [/дач|сад|огород/i, Sprout],
  [/спорт|отдых/i, Bike],
  [/детск/i, Baby],
  [/красот/i, Sparkles],
  [/досуг|развлеч/i, Gamepad2],
  [/здоров/i, HeartPulse],
  [/запчаст/i, Wrench],
  [/оборудован/i, Factory],
  [/дисконт|уценк|распрод/i, BadgePercent],
  [/промо|подар/i, Gift],
];

export function categoryIcon(name: string): LucideIcon {
  return RULES.find(([re]) => re.test(name))?.[1] ?? Package;
}

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  return createElement(categoryIcon(name), { className, "aria-hidden": true });
}
