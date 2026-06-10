import mongoose, { Schema, Document } from "mongoose";

interface StickerPlacement {
  id: string;
  src: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
}

interface Theme {
  colorScheme: {
    background: string;
    text: string;
    accent: string;
    card: string;
  };
  font: string;
  layout: "grid" | "feed" | "masonry";
  customCss: string;
  stickers: StickerPlacement[];
  nowPlaying: {
    url: string | null;
    source: "spotify" | "soundcloud" | "youtube" | null;
  };
  guestbookEnabled: boolean;
}

export interface IUser extends Document {
  telegramId: string;
  telegramUsername: string | null;
  username: string;
  displayName: string;
  bio: string;
  links: Array<{ label: string; url: string }>;
  avatarUrl: string | null;
  platforms: {
    mal: {
      linked: boolean;
      accessToken: string | null;
      refreshToken: string | null;
      expiresAt: Date | null;
    };
  };
  theme: Theme;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    telegramId: {
      type: String,
      required: true,
      unique: true,
    },
    telegramUsername: {
      type: String,
      default: null,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
    },
    displayName: {
      type: String,
      required: true,
    },
    bio: {
      type: String,
      default: "",
      maxlength: 500,
    },
    links: [
      {
        label: { type: String, required: true },
        url: { type: String, required: true },
      },
    ],
    avatarUrl: {
      type: String,
      default: null,
    },
    platforms: {
      mal: {
        linked: { type: Boolean, default: false },
        accessToken: { type: String, default: null },
        refreshToken: { type: String, default: null },
        expiresAt: { type: Date, default: null },
      }
    },
    theme: {
      colorScheme: {
        background: { type: String, default: "#0a0a0a" },
        text: { type: String, default: "#e8e8e8" },
        accent: { type: String, default: "#ff6b6b" },
        card: { type: String, default: "#141414" },
      },
      font: { type: String, default: "Space Mono" },
      layout: {
        type: String,
        enum: ["grid", "feed", "masonry"],
        default: "grid",
      },
      customCss: { type: String, default: "" },
      stickers: [
        {
          id: String,
          src: String,
          x: Number,
          y: Number,
          size: { type: Number, default: 64 },
          rotation: { type: Number, default: 0 },
        }
      ],
      nowPlaying: {
        url: { type: String, default: null },
        source: {
          type: String,
          enum: ["spotify", "soundcloud", "youtube", null],
          default: null,
        },
      },
      guestbookEnabled: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);