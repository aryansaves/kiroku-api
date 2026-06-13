import mongoose, { Schema, Document, Types } from "mongoose";

export type MediaType = "anime" | "movie" | "series" | "book" | "manga" | "comic";
export type LogStatus = "watching" | "completed" | "dropped" | "planned" | "rewatching";

export interface ILog extends Document {
  userId: Types.ObjectId;
  mediaType: MediaType;
  title: string;
  coverImage: string | null;
  status: LogStatus;
  rating: number | null;
  notes: string | null;
  progress: {
    episode: number | null;
    chapter: number | null;
    page: number | null;
    percentage: number | null;
  };
  typeSpecific: Record<string, unknown>; // Stores flexible metadata per media type
  externalIds: {
    malId: number | null;
    anilistId: number | null;
    tmdbId: number | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

const LogSchema = new Schema<ILog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // Optimizes filtering logs by specific user profiles
    },
    mediaType: {
      type: String,
      enum: ["anime", "movie", "series", "book", "manga", "comic"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    coverImage: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["watching", "completed", "dropped", "planned", "rewatching"],
      required: true,
    },
    rating: {
      type: Number,
      min: 0,
      max: 10,
      default: null,
    },
    notes: {
      type: String,
      default: null,
      maxLength: 2000,
    },
    progress: {
      episode: { type: Number, default: null },
      chapter: { type: Number, default: null },
      page: { type: Number, default: null },
      percentage: { type: Number, default: null },
    },
    typeSpecific: {
      type: Schema.Types.Mixed, // Allows flexible, schema-less data shapes per media category
      default: {},
    },
    externalIds: {
      malId: { type: Number, default: null },
      anilistId: { type: Number, default: null },
      tmdbId: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

// Compound Index: Optimizes filtering a specific user's logs by media type or chronological sorting
LogSchema.index({ userId: 1, mediaType: 1, createdAt: -1 });

export const Log = mongoose.model<ILog>("Log", LogSchema);