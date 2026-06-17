import mongoose, { Schema, Document, Types } from "mongoose";

export interface IGuestbookEntry extends Document {
  userId: Types.ObjectId;
  visitorName: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

const GuestbookEntrySchema = new Schema<IGuestbookEntry>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    visitorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 48,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 280,
    },
  },
  { timestamps: true }
);

GuestbookEntrySchema.index({ userId: 1, createdAt: -1 });

export const GuestbookEntry = mongoose.model<IGuestbookEntry>(
  "GuestbookEntry",
  GuestbookEntrySchema
);
