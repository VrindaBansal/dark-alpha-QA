import { auth } from "@/app/(auth)/auth";
import { extractQuestionsSchema } from "@/lib/schemas/extract-questions-schema";
import { NextRequest, NextResponse } from "next/server";
import { openaiProvider, openaiClient } from "@/lib/ai/providers";
import { generateObject } from "ai";
import { z } from "zod";
import { publishUploadProgress } from "@/lib/redis-publisher";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  console.log("inside api extract questions");

  const userSession = await auth();

  if (!userSession?.user) {
    console.log("Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    console.log("No file provided");
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  try {
    extractQuestionsSchema.parse({ file });
  } catch (error) {
    console.log("Invalid file");
    return NextResponse.json(
      { error: "Invalid file" },
      { status: 400, statusText: "Invalid file" }
    );
  }

  // Generate jobId for progress tracking
  const jobId = uuidv4();
  const fileType = file.type;
  const buffer = await file.arrayBuffer();

  // Publish initial progress
  await publishUploadProgress({
    jobId,
    currentFile: 1,
    totalFiles: 1,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    status: "processing",
    progress: 10,
    timestamp: Date.now(),
  });

  console.log("analysing pdf using AI");
  try {
    // Update progress: AI analysis started
    await publishUploadProgress({
      jobId,
      currentFile: 1,
      totalFiles: 1,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      status: "processing",
      progress: 30,
      timestamp: Date.now(),
    });

    const result = await generateObject({
      model: openaiProvider.responses("gpt-4o"),
      schema: z.object({
        questions: z.array(
          z.object({
            title: z.string().describe("The question to be asked"),
          })
        ),
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Please analyze this PDF document and extract ONLY the due diligence questions. 

If the document contains a list of due diligence questions or a questionnaire:
- Extract each question exactly as written
- Do not include any additional context, explanations, or commentary
- Format each question as a separate item

If the document does not contain any due diligence questions or a questionnaire:
- Return an empty list of questions
- Do not attempt to generate or create questions

Focus solely on identifying and extracting actual questions from the document.

The document is a PDF file.`,
            },
            {
              type: "file",
              data: buffer,
              mimeType: "application/pdf",
              filename: file.name,
            },
          ],
        },
      ],
    });

    console.log("Result from analysing pdf using AI", result.object);

    // Publish completion progress
    await publishUploadProgress({
      jobId,
      currentFile: 1,
      totalFiles: 1,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      status: "completed",
      progress: 100,
      timestamp: Date.now(),
    });

    return NextResponse.json(
      { message: "Questions extracted", questions: result.object.questions, jobId },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error extracting questions", error);

    // Publish failure progress
    await publishUploadProgress({
      jobId,
      currentFile: 1,
      totalFiles: 1,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      status: "failed",
      progress: 0,
      timestamp: Date.now(),
    });

    return NextResponse.json(
      { error: "Error extracting questions" },
      { status: 500 }
    );
  }
}
