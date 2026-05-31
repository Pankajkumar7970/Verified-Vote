import React from "react";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circle" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export default function Skeleton({
  className = "",
  variant = "rectangular",
  width,
  height,
}: SkeletonProps) {
  const baseStyles = "animate-pulse bg-gray-200 rounded";
  const variantStyles = {
    text: "h-4",
    circle: "rounded-full",
    rectangular: "",
  };

  return (
    <div
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      style={{ width, height }}
    />
  );
}
