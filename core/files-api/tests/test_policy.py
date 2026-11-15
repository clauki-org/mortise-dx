# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử phần thuần của files-api: tên tệp, giới hạn cỡ, header tải xuống.

import hashlib

import pytest

from app.policy import MAX_NAME_LENGTH, Denied, Receiver, clean_name, content_disposition


def test_name_drops_directories_from_both_separators():
    assert clean_name("../../etc/passwd") == "passwd"
    assert clean_name("C:\\Users\\a\\bien ban.pdf") == "bien ban.pdf"


def test_name_drops_control_characters():
    assert clean_name("bao\x00cao\n.pdf") == "baocao.pdf"


@pytest.mark.parametrize("name", [None, "", "   ", "a/", "..", "x" * (MAX_NAME_LENGTH + 1)])
def test_unusable_name_is_rejected(name):
    with pytest.raises(Denied) as error:
        clean_name(name)
    assert error.value.status == 400


def test_receiver_hashes_what_it_counted():
    receiver = Receiver(limit=10)
    for chunk in (b"abc", b"de"):
        receiver.add(chunk)
    assert receiver.size == 5
    assert receiver.finish() == hashlib.sha256(b"abcde").hexdigest()


def test_receiver_stops_at_the_first_chunk_over_the_limit():
    receiver = Receiver(limit=4)
    receiver.add(b"abcd")
    with pytest.raises(Denied) as error:
        receiver.add(b"e")
    assert error.value.status == 413


def test_empty_upload_is_rejected():
    with pytest.raises(Denied) as error:
        Receiver(limit=4).finish()
    assert error.value.status == 400


def test_download_is_always_an_attachment_and_keeps_vietnamese_names():
    header = content_disposition('Biên bản "họp".pdf')
    assert header.startswith("attachment; ")
    assert "filename*=UTF-8''Bi%C3%AAn%20b%E1%BA%A3n%20%22h%E1%BB%8Dp%22.pdf" in header
    assert '"Bi?n' not in header
