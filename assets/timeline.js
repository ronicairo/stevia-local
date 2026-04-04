/*!
 * timeline v1.1.0 - jQuery plug
 *
 * Includes jquery.js
 * Includes raphael.js
 *
 * Copyright © 2016-2017 huangqing
 * Released under the MIT license
 *
 * Date: 2016-11-15
 */

(function ($) {

    'use strict';
    $.fn.extend({
        timeline: function (opt) {

            let container = this,
                paper = container.data('timeline'),
                pagerHeight = 0,
                pagerWidth = 0,
                ViewBoxX = 0,
                ViewBoxY = 0,
                startX = 0,
                startY = 0,
                nextX = startX,
                nextY = startY,
                endX = 0,
                endY = 0,
                currentBranchCount = 0,
                legend = {},
                legendHeight = 60,
                data = [],
                theme = $.extend(true, {}, $.timeline.theme.gray);

            $.extend(true, theme, opt.theme);

            if (!paper) {
                paper = Raphael(container[0]);
                container.data('timeline', paper);
            } else {
                paper.clear();
            }

            //计算下一节点的X轴起始位置
            function getNextX(offsetWidth) {
                nextX += offsetWidth;
            }

            ///计算下一节点的Y轴起始位置：用于分支节点的高度计算
            function getNextY() {
                let r = 10,
                    lineHeight = 0,
                    operator = +1,
                    baseLineHeight = 6 * r,
                    offsetHeight = 4 * r;
                //Y轴坐标为初始坐标，根据子节点的数量计算高度
                //第一个子节点首先定位在Y轴反向位置，第二个子节点定位在Y轴正向与第一个节点对称的位置
                if (nextY === startY) {
                    operator = -1;
                    lineHeight = baseLineHeight + Math.ceil(currentBranchCount / 2) * offsetHeight;
                    lineHeight = operator * (Math.abs(lineHeight) - offsetHeight);
                    nextY = startY + lineHeight;
                    setEndY(lineHeight);

                }
                //定位Y轴正向节点
                else if (nextY < startY) {
                    nextY = Math.abs(nextY);
                }
                //递减定位下一个节点
                else {
                    operator = -1;
                    lineHeight = operator * (Math.abs(nextY) - offsetHeight);
                    nextY = startY + lineHeight;
                }
            }

            //设置x轴结束位置
            function setEndX(x) {
                if (endX < x) {
                    endX = x;
                }
            }

            //获取皮肤
            function getTheme() {
                return theme;
            }

            //计算图形最高高度
            function setEndY(offsetHeight) {
                if (Math.abs(endY) < Math.abs(offsetHeight)) {
                    endY = Math.abs(offsetHeight);
                }
            }

            //获取图片url
            //imageUrl:url字符串，或url数组
            function getImageUrl(imageUrl, legendType) {

                let url = [],
                    image,
                    host;

                if (legend[legendType] && legend[legendType].icon) {
                    url.push(legend[legendType].icon);
                }

                if (imageUrl && typeof imageUrl === 'string') {
                    url.push(imageUrl);
                } else if (imageUrl instanceof Array && imageUrl.length > 0) {
                    url = url.concat(imageUrl);
                }

                for (let i = 0, len = url.length; i < len; i++) {
                    image = url[i];
                    if (image.indexOf("~") === 0) {
                        host = location.protocol + "//" + location.hostname + (location.port ? ":" + location.port : "");
                        url[i] = image.replace(/~/, host);
                    }
                }

                return url;
            }

            //创建开始节点
            function createStartNode(x, y) {
                let theme = getTheme().startNode,
                    r = theme.radius,
                    bgColor = theme.fill,
                    lineWidth = 60;

                x += r;

                paper.circle(x, y, r).attr({
                    fill: bgColor,
                    "stroke-width": 0,
                    stroke: bgColor
                });

                paper.path("M" + x + " " + y + "L" + (x + lineWidth - 10) + " " + y).attr({
                    "stroke-width": 2,
                    stroke: bgColor,
                    "stroke-dasharray": ["-"]
                });

                getNextX(lineWidth);
            }

            //创建结束节点
            function createEndNode(x, y) {
                let theme = getTheme().endNode,
                    r = theme.radius,
                    bgColor = theme.fill,
                    lineWidth = 60,
                    _endX = x + lineWidth;

                if (_endX < endX) {
                    lineWidth = endX - x;
                }
                let pathStr = "M" + x + " " + y + "L" + (x + lineWidth) + " " + y;
                paper.path(pathStr).attr({
                    "stroke-width": 2,
                    stroke: bgColor,
                    "stroke-dasharray": ["-"]
                });

                pathStr = ["M", x + lineWidth, " ", y,
                    "L", x + lineWidth, " ", y + r,
                    "L", x + lineWidth + r, " ", y,
                    "L", x + lineWidth, " ", y - r,
                    "L", x + lineWidth, " ", y,
                    "z"
                ].join("");
                paper.path(pathStr).attr({
                    fill: bgColor,
                    "stroke-width": 0,
                    stroke: bgColor
                });

                getNextX(lineWidth + r);
            }

            //创建中轴线上的主节点
            function createCentralAxisNode(x, y, text, imageUrl) {

                let lines = text.split("\n");
                let theme = getTheme().centralAxisNode,
                    height = theme.height * lines.length,
                    outRectElement,
                    imageX,
                    imageY,
                    imageWidth = 0,
                    imageElements = [],
                    imageSize = 14,
                    textElement,
                    paddingSize = 4,
                    radius = theme.radius,
                    textFillColor = theme.color,
                    position,
                    lineWidth,
                    contentX = x;

                if (imageUrl && imageUrl.length > 0) {

                    imageX = x + 2 * paddingSize;
                    imageY = y - imageSize / 2 + 1;
                    for (let i = 0, len = imageUrl.length; i < len; i++) {
                        imageElements.push(paper.image(imageUrl[i], imageX, imageY, imageSize, imageSize));
                        if (i !== len - 1) {
                            imageX += paddingSize + imageSize;
                        } else {
                            imageX += paddingSize;
                        }
                    }
                    imageWidth = imageX - x;
                }

                x = x + imageWidth + 3 * paddingSize;


                let tE = paper.text(x, y, text).attr({
                    "font-size": 12,
                    "font-weight": "bolder",
                    fill: textFillColor,
                    "text-anchor": "start"
                });

                if(lines.length > 1){
                    y = y + (tE.getBBox(false).height / 2) - 12 ;
                }

                tE.remove();

                textElement = paper.text(x, y, text).attr({
                    "font-size": 12,
                    "font-weight": "bolder",
                    fill: textFillColor,
                    "text-anchor": "start"
                });



                position = textElement.getBBox();
                let width = position.width;

                paper.rect(contentX + paddingSize, y - height / 2, width + 4 * paddingSize + imageWidth, height , radius).attr({
                    fill: theme.inner.fill,
                    "stroke-width": theme.inner["stroke-width"],
                    stroke: theme.inner.stroke
                });
// -10.5


//                outRectElement = paper.rect(contentX, y - height / 2 - paddingSize, width + imageWidth + 6 * paddingSize, height + 2 * paddingSize, radius).attr({
//                    stroke: theme.outer.stroke,
//                    "stroke-width": theme.outer["stroke-width"]
//                });


                outRectElement = paper.rect(contentX, (theme.height * -1 / 2) - paddingSize , width + imageWidth + 6 * paddingSize , height +  2  * paddingSize, radius).attr({
                    stroke: theme.outer.stroke,
                    "stroke-width": theme.outer["stroke-width"]
                });

                textElement.toFront();
                for (let i = 0, len = imageElements.length; i < len; i++) {
                    imageElements[i].toFront();
                }

                position = outRectElement.getBBox();
                lineWidth = position.width;

                getNextX(lineWidth);
                endY === 0 ? endY = Math.ceil(position.height / 2) + 6 : null;
            }

            //创建中轴线上的线
            function createCentralAxisLine(x, y) {

                let r = 10,
                    theme = getTheme().centralAxisLine,
                    bgColor = theme.fill,
                    lineWidth = 4 * r;

                let pathStr = "M" + x + " " + y + "L" + (x + lineWidth) + " " + y;
                paper.path(pathStr).attr({
                    "stroke-width": 2,
                    stroke: bgColor,
                    "stroke-dasharray": ["-"]
                });

                getNextX(lineWidth);
            }

            //创建中轴线上的分支节点
            function createCentralAxisBranchNode(x, y) {
                let theme = getTheme().centralAxisBranchNode,
                    r = theme.radius,
                    bgColor = theme.fill;

                paper.circle(x, y, r - 2).attr({
                    "stroke-width": 2,
                    stroke: bgColor
                });

                paper.circle(x, y, r - 5).attr({
                    fill: bgColor,
                    "stroke-width": 0,
                    stroke: bgColor
                });

            }

            //创建中轴线上分支节点的内容
            function createCentralAxisBranchContent(x, y, text, imageUrl) {

                let r = 10,
                    r_bottom = 2,
                    content_theme = getTheme().centralAxisBranchContent,
                    line_theme = getTheme().centralAxisBranchLine,
                    bgColor = content_theme.fill,
                    textFillColor = content_theme.color,
                    stroke = content_theme.stroke,
                    height = content_theme.height,
                    operator,
                    contentX,
                    contentY,
                    imageX,
                    imageY,
                    imageWidth = 0,
                    textX,
                    textY,
                    textElement,
                    imageElements = [],
                    imageSize = 14,
                    position;

                getNextY();
                nextY > 0 ? operator = +1 : operator = -1;
                let _endY = nextY;


                let pathStr = "M" + x + " " + y + "L" + x + " " + _endY;
                paper.path(pathStr).attr({
                    "stroke-width": 1,
                    stroke: line_theme.stroke
                });

                paper.circle(x, _endY - operator * r_bottom, r_bottom).attr({
                    fill: line_theme.stroke,
                    "stroke-width": 0,
                    stroke: line_theme.stroke
                });

                let _endX = x - 2 * r;
                _endY = operator > 0 ? _endY - operator * (height + 6) :
                    _endY - operator * 6 + r_bottom;

                contentX = _endX;
                contentY = _endY;
                imageX = contentX + content_theme["padding"];

                if (imageUrl && imageUrl.length > 0) {

                    imageX = imageX + r / 2;
                    imageY = contentY + 4;
                    for (let i = 0, len = imageUrl.length; i < len; i++) {
                        imageElements.push(paper.image(imageUrl[i], imageX, imageY, imageSize, imageSize));
                        if (i !== len - 1) {
                            imageX += r / 2 + imageSize;
                        } else {
                            imageX += r;
                        }
                    }
                    imageWidth = imageX - contentX;
                }

                textX = imageX + r;
                textY = contentY + r;
                textElement = paper.text(textX, textY, text).attr({
                    "font-size": 12,
                    fill: textFillColor,
                    "text-anchor": "start",
                    title: text
                });

                position = textElement.getBBox();
                height = position.height + 5;

                paper.rect(contentX, contentY, imageWidth + position.width + content_theme["padding"] + 2 * r, height, content_theme.radius).attr({
                    fill: bgColor,
                    stroke: stroke,
                    "stroke-width": 1
                });

                //判断分支内容的实际结束位置，用于作为生成结束节点的x轴参数
                _endX = contentX + imageWidth + position.width + 2 * r;
                setEndX(_endX);

                for (let i = 0, len = imageElements.length; i < len; i++) {
                    imageElements[i].toFront();
                }
                textElement.toFront();
            }

            //创建中轴线上的分支节点
            function createBranchNode(x, y, text, imageUrl, radius) {
                let r = radius;
                createCentralAxisLine(x, y);
                //中间位置
                x += r * 2;
                createCentralAxisBranchNode(x, y);
                createCentralAxisBranchContent(x, y, text, imageUrl);
            }

            //创建图例
            function createLegend() {
                let item,
                    text,
                    imageUrl,
                    r = 5,
                    imageSize = 14,
                    position,
                    _startX = startX + 2 * r,
                    _startY,
                    textElement;

                _startY = -(endY + legendHeight) + 4 * r;

                for (let i in legend) {
                    item = legend[i];
                    text = item.text;
                    imageUrl = getImageUrl(item.icon);

                    paper.image(imageUrl, _startX - 6, _startY - 6, imageSize, imageSize);

                    _startX += imageSize;
                    textElement = paper.text(_startX, _startY, text).attr({
                        "font-size": 12,
                        "fill": theme.lengend.fill,
                        "text-anchor": "start"
                    });

                    position = textElement.getBBox();
                    _startX += position.width + 4 * r;

                }

            }

            function init(opt) {

                let _legend,
                    children = [],
                    item,
                    text,
                    imageUrl,
                    r;

                _legend = opt.legend || [];
                data = opt.data || [];

                if (_legend.length === 0) {
                    legendHeight = 0;
                }
                //将图例数据格式转换为以name类型为键值的对象
                for (let i = 0, len = _legend.length; i < len; i++) {
                    item = _legend[i];
                    legend[item.name] = item;
                }

                if (!data || data.length === 0) {
                    return;
                }

                //创建开始节点
                createStartNode(startX, startY);
                //创建内容节点
                for (let i = 0, len = data.length; i < len; i++) {
                    item = data[i];
                    text = item.text;
                    imageUrl = getImageUrl(item.imageUrl, null);
                    children = item.children || [];
                    r = 10;
                    //创建主节点
                    createCentralAxisNode(nextX, startY, text, imageUrl);
                    //创建分支节点
                    if (children.length === 0 && i !== len - 1) {
                        //不存在分支节点，只创建中轴线
                        createCentralAxisLine(nextX, startY);
                    } else if (children.length > 0) {
                        //重置nextY,新的主节点下的分支节点Y轴位置回复为初始位置
                        nextY = startY;
                        currentBranchCount = children.length;
                        //存在分支节点，创建分支内容节点
                        for (let j = 0, lenj = children.length; j < lenj; j++) {
                            item = children[j];
                            text = item.text;
                            imageUrl = getImageUrl(item.imageUrl, item.legendName);
                            createBranchNode(nextX, startY, text, imageUrl, r);
                        }
                    }
                }

                //创建结束节点
                createEndNode(nextX, startY);

                //创建图例
                createLegend();
                //设置画布大小
                pagerWidth = nextX + ViewBoxX;
                pagerHeight = Math.abs(endY * 2) + legendHeight;
                paper.setSize(pagerWidth, pagerHeight);
                //设置ViewBox偏移量
                ViewBoxY = Math.abs(endY * 2) / 2 + legendHeight;
                paper.setViewBox(-ViewBoxX, -ViewBoxY, pagerWidth, pagerHeight, false);
            }

            container.addClass("timeline");
            init(opt);
            return container;
        },
    });

    $.extend({
        timeline: {
            theme: {
                yellow: {
                    lengend: {
                        fill: "#000000",
                    },
                    startNode: {
                        radius: 10,
                        fill: "#7E899D"
                    },
                    endNode: {
                        radius: 10,
                        fill: "#7E899D"
                    },
                    centralAxisNode: {
                        height: 21,
                        radius: 4,
                        fill: "#1A84CE",
                        color: "#ffffff",
                        inner: {
                            fill: "#1A84CE",
                            "stroke-width": 0,
                            stroke: "#1A84CE"
                        },
                        outer: {
                            fill: "#1A84CE",
                            "stroke-width": 3,
                            stroke: "#1A84CE"
                        }
                    },
                    centralAxisLine: {
                        fill: "#7E899D"
                    },
                    centralAxisBranchNode: {
                        fill: "#F9BF3B",
                        radius: 10
                    },
                    centralAxisBranchLine: {
                        stroke: '#F9BF3B',
                        fill: "#F9BF3B"
                    },
                    centralAxisBranchContent: {
                        fill: "#F9BF3B",
                        color: "#ffffff",
                        stroke: '#ffffff',
                        height: 24,
                        radius: 6,
                        "padding": 0
                    }
                },
                gray: {
                    lengend: {
                        fill: "#5A5A5A",
                    },
                    startNode: {
                        radius: 6,
                        fill: "#7E899D"
                    },
                    endNode: {
                        radius: 6,
                        fill: "#7E899D"
                    },
                    centralAxisNode: {
                        height: 18,
                        radius: 2,
                        //fill: "#1A84CE",
                        color: "#1A84CE",
                        inner: {
                            fill: "#ffffff",
                            "stroke-width": 0,
                            stroke: "#1A84CE"
                        },
                        outer: {
                            fill: "#1A84CE",
                            "stroke-width": 2,
                            stroke: "#1A84CE"
                        }
                    },
                    centralAxisLine: {
                        fill: "#7E899D"
                    },
                    centralAxisBranchNode: {
                        fill: "#7E899D",
                        radius: 8
                    },
                    centralAxisBranchLine: {
                        stroke: '#526079',
                        fill: "'#526079"
                    },
                    centralAxisBranchContent: {
                        fill: "#FFFFFF",
                        color: "#111111",
                        stroke: '#526079',
                        height: 24,
                        radius: 12,
                        "padding": 6
                    }
                }
            }
        }
    });

})(jQuery);