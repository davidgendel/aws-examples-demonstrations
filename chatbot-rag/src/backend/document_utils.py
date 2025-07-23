"""
Document processing utilities for the chatbot backend.
"""
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from .aws_utils import get_s3_client, get_textract_client

# Initialize logger
logger = logging.getLogger(__name__)


def extract_headings(content: str, file_type: str) -> List[Dict[str, Any]]:
    """
    Extract headings from markdown or HTML.
    
    Args:
        content: Document content
        file_type: File type (md, html, etc.)
        
    Returns:
        List of headings with level, text, and position
    """
    headings = []
    
    if file_type == "md":
        # Extract markdown headings
        heading_regex = r"^(#{1,6})\s+(.+)$"
        for match in re.finditer(heading_regex, content, re.MULTILINE):
            headings.append({
                "level": len(match.group(1)),
                "text": match.group(2).strip(),
                "startPosition": match.start()
            })
    elif file_type in ["html", "htm"]:
        # Extract HTML headings
        heading_regex = r"<h([1-6])[^>]*>(.*?)</h\1>"
        for match in re.finditer(heading_regex, content, re.IGNORECASE):
            # Remove HTML tags from heading text
            text = re.sub(r"<[^>]*>", "", match.group(2)).strip()
            
            headings.append({
                "level": int(match.group(1)),
                "text": text,
                "startPosition": match.start()
            })
    
    return headings


def estimate_heading_level(block: Dict[str, Any]) -> int:
    """
    Estimate heading level from Textract block.
    
    Args:
        block: Textract block
        
    Returns:
        Estimated heading level
    """
    # This is a simplified approach - in a real implementation,
    # you would use font size, style, and position to determine heading level
    if block.get("TextType") == "HEADING":
        return 1  # Assume it's a top-level heading
    elif block.get("Text", "").strip().endswith(":"):
        return 2  # Assume it's a subheading
    else:
        return 3  # Default level


def get_text_from_block(block: Dict[str, Any], all_blocks: List[Dict[str, Any]]) -> str:
    """
    Get text from a Textract block.
    
    Args:
        block: Textract block
        all_blocks: All Textract blocks
        
    Returns:
        Block text
    """
    if block.get("Text"):
        return block["Text"]
    
    if block.get("Relationships"):
        child_relation = next(
            (rel for rel in block["Relationships"] if rel["Type"] == "CHILD"),
            None
        )
        if child_relation:
            return " ".join(
                block.get("Text", "")
                for block_id in child_relation["Ids"]
                if (block := next((b for b in all_blocks if b["Id"] == block_id), None))
                and block.get("Text")
            )
    
    return ""


def get_value_block(
    key_block: Dict[str, Any], all_blocks: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Get value block for a key block.
    
    Args:
        key_block: Key block
        all_blocks: All Textract blocks
        
    Returns:
        Value block or None
    """
    if key_block.get("Relationships"):
        value_relation = next(
            (rel for rel in key_block["Relationships"] if rel["Type"] == "VALUE"),
            None
        )
        if value_relation and value_relation["Ids"]:
            return next(
                (b for b in all_blocks if b["Id"] == value_relation["Ids"][0]),
                None
            )
    
    return None


def process_table(table_block: Dict[str, Any], all_blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Process table data from Textract.
    
    Args:
        table_block: Table block
        all_blocks: All Textract blocks
        
    Returns:
        Processed table data
    """
    table = {
        "rows": [],
        "rowCount": 0,
        "columnCount": 0
    }
    
    # Find all cells belonging to this table
    cell_blocks = [
        block for block in all_blocks
        if block["BlockType"] == "CELL"
        and block.get("Relationships")
        and any(
            rel["Type"] == "CHILD" and table_block["Id"] in rel["Ids"]
            for rel in block["Relationships"]
        )
    ]
    
    # Organize cells by row and column
    for cell in cell_blocks:
        row_index = cell["RowIndex"] - 1
        col_index = cell["ColumnIndex"] - 1
        
        # Update table dimensions
        table["rowCount"] = max(table["rowCount"], row_index + 1)
        table["columnCount"] = max(table["columnCount"], col_index + 1)
        
        # Ensure row exists
        while len(table["rows"]) <= row_index:
            table["rows"].append([])
        
        # Get cell text
        cell_text = get_text_from_block(cell, all_blocks)
        
        # Ensure column exists in row
        while len(table["rows"][row_index]) <= col_index:
            table["rows"][row_index].append("")
        
        # Add cell to table
        table["rows"][row_index][col_index] = cell_text
    
    return table


def extract_text_from_document(bucket: str, key: str) -> Dict[str, Any]:
    """
    Extract text and metadata from document using Textract.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        Extracted content and metadata
    """
    try:
        # Initialize AWS clients
        s3_client = get_s3_client()
        textract_client = get_textract_client()
        
        # Determine file type from key
        file_extension = key.split(".")[-1].lower()
        file_name = key.split("/")[-1]
        
        # Get file metadata from S3
        head_response = s3_client.head_object(Bucket=bucket, Key=key)
        file_size = head_response["ContentLength"]
        last_modified = head_response["LastModified"].isoformat()
        metadata = head_response.get("Metadata", {})
        
        # Initialize document metadata
        document_metadata = {
            "fileName": file_name,
            "fileExtension": file_extension,
            "fileSize": file_size,
            "lastModified": last_modified,
            "s3Metadata": metadata,
            "source": bucket,
            "extractionMethod": ""
        }
        
        extracted_content = {
            "text": "",
            "title": file_name,
            "metadata": document_metadata,
            "structure": []
        }
        
        if file_extension in ["txt", "md", "html", "htm", "csv", "json"]:
            # For text files, read directly from S3
            response = s3_client.get_object(Bucket=bucket, Key=key)
            content = response["Body"].read().decode("utf-8")
            
            document_metadata["extractionMethod"] = "direct"
            
            # Extract title and structure based on file type
            if file_extension in ["md", "html", "htm"]:
                # Extract headings for markdown or HTML
                headings = extract_headings(content, file_extension)
                extracted_content["structure"] = headings
                
                # Use first heading as title if available
                if headings and headings[0]["level"] == 1:
                    extracted_content["title"] = headings[0]["text"]
            elif file_extension == "json":
                try:
                    # Try to parse JSON for potential metadata
                    json_content = json.loads(content)
                    if json_content.get("title"):
                        extracted_content["title"] = json_content["title"]
                    if json_content.get("metadata"):
                        document_metadata["jsonMetadata"] = json_content["metadata"]
                except Exception as e:
                    logger.warning(f"Failed to parse JSON metadata: {e}")
            
            extracted_content["text"] = content
            extracted_content["metadata"] = document_metadata
            
            return extracted_content
        elif file_extension in ["pdf", "png", "jpg", "jpeg", "tiff"]:
            document_metadata["extractionMethod"] = "textract"
            
            # For documents and images, use Textract with enhanced features
            response = textract_client.analyze_document(
                Document={
                    "S3Object": {
                        "Bucket": bucket,
                        "Name": key
                    }
                },
                FeatureTypes=["TABLES", "FORMS", "SIGNATURES"],
                QueriesConfig={
                    "Queries": [
                        {"Text": "What is the document title?"},
                        {"Text": "Who is the author of this document?"},
                        {"Text": "What is the date of this document?"}
                    ]
                }
            )
            
            # Extract text from blocks
            extracted_text = ""
            current_heading = None
            structure = []
            page_number = 1
            tables = []
            forms = {}
            query_results = {}
            
            # Process Textract blocks
            for block in response["Blocks"]:
                if block["BlockType"] == "LINE":
                    # Check if this line might be a heading (based on font size or style)
                    is_heading = (
                        block.get("Text")
                        and (
                            block.get("TextType") == "HEADING"
                            or (block.get("Page") and block["Page"] != page_number)
                            or (
                                block.get("Text")
                                and len(block["Text"].strip()) < 100
                                and block["Text"].strip().endswith(":")
                            )
                        )
                    )
                    
                    if is_heading:
                        current_heading = {
                            "text": block["Text"],
                            "level": estimate_heading_level(block),
                            "startPosition": len(extracted_text)
                        }
                        structure.append(current_heading)
                        
                        # Use first heading as potential title
                        if len(structure) == 1:
                            extracted_content["title"] = block["Text"]
                    
                    if block.get("Text"):
                        extracted_text += block["Text"] + "\n"
                    
                    # Update page number if changed
                    if block.get("Page"):
                        page_number = block["Page"]
                elif block["BlockType"] == "TABLE":
                    # Process table data
                    table = process_table(block, response["Blocks"])
                    tables.append(table)
                    extracted_text += f"[TABLE {len(tables)}]\n"
                elif (
                    block["BlockType"] == "KEY_VALUE_SET"
                    and block.get("EntityTypes")
                    and "KEY" in block["EntityTypes"]
                ):
                    # Process form fields
                    key = get_text_from_block(block, response["Blocks"])
                    value_block = get_value_block(block, response["Blocks"])
                    value = get_text_from_block(value_block, response["Blocks"]) if value_block else ""
                    
                    if key and value:
                        forms[key] = value
                        
                        # Check for common metadata fields
                        key_lower = key.lower()
                        if "title" in key_lower:
                            extracted_content["title"] = value
                        elif "author" in key_lower:
                            document_metadata["author"] = value
                        elif "date" in key_lower:
                            document_metadata["date"] = value
                elif block["BlockType"] == "QUERY_RESULT":
                    # Process query results
                    if block.get("Query") and block["Query"].get("Text") and block.get("Text"):
                        query_results[block["Query"]["Text"]] = block["Text"]
                        
                        # Use query results for metadata
                        if block["Query"]["Text"] == "What is the document title?":
                            extracted_content["title"] = block["Text"]
                        elif block["Query"]["Text"] == "Who is the author of this document?":
                            document_metadata["author"] = block["Text"]
                        elif block["Query"]["Text"] == "What is the date of this document?":
                            document_metadata["date"] = block["Text"]
            
            # Add extracted data to metadata
            document_metadata["tables"] = tables
            document_metadata["forms"] = forms
            document_metadata["queryResults"] = query_results
            document_metadata["pageCount"] = page_number
            
            extracted_content["text"] = extracted_text
            extracted_content["structure"] = structure
            extracted_content["metadata"] = document_metadata
            
            return extracted_content
        else:
            raise ValueError(f"Unsupported file type: {file_extension}")
    except Exception as e:
        logger.error(f"Error extracting text: {e}", exc_info=True)
        raise
